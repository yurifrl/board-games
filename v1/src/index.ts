import { Hono } from "hono";
import type { Context } from "hono";
import { join } from "node:path";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { groupGames, loadGames } from "./games.ts";
import {
  authenticate,
  getPermission,
  listRoles,
  loadConfig,
  resolveExplicit,
  rolesExist,
} from "./whitelist.ts";
import type { Permission } from "./whitelist.ts";
import {
  issueInviteToken,
  issueSessionToken,
  verifyInvite,
  verifySession,
} from "./auth.ts";
import { getTmpUser, upsertTmpUser } from "./tmpusers.ts";
import { collectionPage, invitePage } from "./views.ts";

const env = (k: string, d?: string): string => process.env[k] ?? d ?? "";

const SECRET = env("AUTH_SECRET");
if (!SECRET || SECRET === "change-me-to-a-32-byte-random-hex") {
  console.warn("⚠️  AUTH_SECRET is unset or default. Set a strong secret in production.");
}

const BASE_URL = env("BASE_URL", "http://localhost:3000");
const SESSION_TTL_DAYS = Number(env("SESSION_TTL_DAYS", "7"));
const DEFAULT_INVITE_ROLE = env("DEFAULT_INVITE_ROLE", "buyer");
const INVENTORY_DIR = env("INVENTORY_DIR", "../../../Yuri/Resources/Board Games/Inventory");
const WHITELIST_CONFIG_PATH = env("WHITELIST_CONFIG_PATH", "./whitelist-config.yaml");
const WHITELIST_USERS_PATH = env("WHITELIST_USERS_PATH", "./whitelist-users.txt");
const TMP_USERS_PATH = env("TMP_USERS_PATH", "./tmp-users.jsonl");
const COVERS_DIR = env("COVERS_DIR", "./data");
const WHATSAPP = env("WHATSAPP_NUMBER");
const PORT = Number(env("PORT", "3000"));
const SECURE = BASE_URL.startsWith("https://");

const COOKIE = "bg_session";
const app = new Hono();

// The permission used for anonymous public visitors: collection visible, secret
// info (prices, for-sale, bidding) hidden.
const PUBLIC_PERM: Permission = {
  email: "",
  roles: [],
  canSeePrices: false,
  canBid: false,
  admin: false,
};

function setSessionCookie(c: Context, token: string) {
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: SECURE,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 86400,
  });
}

/** Resolve the current signed-in user from the session cookie (stateless). */
async function currentUser(c: Context) {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const claims = await verifySession(SECRET, token);
  if (!claims) return null;
  // Temp users live in the JSONL db; look them up each request (revocation is instant).
  if (claims.tmp) {
    const tu = await getTmpUser(TMP_USERS_PATH, claims.email);
    if (!tu) return null; // removed/revoked from the db
    return resolveExplicit(WHITELIST_CONFIG_PATH, claims.email, tu.roles);
  }
  // Permanent users: re-check the whitelist every request so revocation is immediate.
  return getPermission(WHITELIST_CONFIG_PATH, WHITELIST_USERS_PATH, claims.email);
}

/** Render the public collection, optionally with the login modal overlaid. */
async function renderHome(c: Context, login?: { error?: string }, status = 200) {
  const perm = await currentUser(c);
  const isAuthed = !!perm;
  const effective = perm ?? PUBLIC_PERM;
  const games = await loadGames(INVENTORY_DIR);
  const groups = groupGames(games);
  const roles = await listRoles(WHITELIST_CONFIG_PATH);
  const html = collectionPage({
    groups,
    totalGames: games.length,
    forSaleCount: games.filter((g) => g.forSale).length,
    perm: effective,
    email: effective.email,
    whatsapp: WHATSAPP,
    roles: roles.filter((r) => r !== "admin"),
    defaultRole: DEFAULT_INVITE_ROLE,
    isAuthed,
    login,
  });
  return c.html(html, status as 200);
}

app.get("/", (c) => renderHome(c));

// Hidden login: the public collection with the login modal floating above it.
app.get("/login", (c) => renderHome(c, {}));

// Stateless password login for permanent users.
app.post("/auth/login", async (c) => {
  const form = await c.req.parseBody();
  const email = String(form["email"] ?? "").trim().toLowerCase();
  const password = String(form["password"] ?? "");
  if (!email || !password) {
    return renderHome(c, { error: "Email and password are required." }, 400);
  }
  const perm = await authenticate(WHITELIST_CONFIG_PATH, WHITELIST_USERS_PATH, email, password);
  if (!perm) {
    return renderHome(c, { error: "Invalid email or password." }, 401);
  }
  setSessionCookie(c, await issueSessionToken(SECRET, perm.email, SESSION_TTL_DAYS * 86400));
  return c.redirect("/");
});

// Admin-only: record a temp user in the JSONL db and return their invite link.
app.post("/admin/invite", async (c) => {
  const perm = await currentUser(c);
  if (!perm?.admin) return c.text("Forbidden", 403);

  const form = await c.req.parseBody();
  const email = String(form["email"] ?? "").trim().toLowerCase();
  const role = String(form["role"] ?? DEFAULT_INVITE_ROLE).trim();
  if (!email) return c.text("Email is required", 400);
  if (role === "admin" || !(await rolesExist(WHITELIST_CONFIG_PATH, [role]))) {
    return c.text("Invalid role", 400);
  }

  await upsertTmpUser(TMP_USERS_PATH, { email, roles: [role], createdBy: perm.email });
  const token = await issueInviteToken(SECRET, email);
  const link = `${BASE_URL}/auth/invite?token=${encodeURIComponent(token)}`;
  return c.html(invitePage({ link, email, role }));
});

// Redeem an invite link -> temp session, but only if the user still exists in the db.
app.get("/auth/invite", async (c) => {
  const token = c.req.query("token") ?? "";
  const invite = await verifyInvite(SECRET, token);
  if (!invite) return renderHome(c, { error: "That invite link is invalid." }, 401);

  const tu = await getTmpUser(TMP_USERS_PATH, invite.email);
  if (!tu) return renderHome(c, { error: "This invite has been revoked." }, 401);

  const session = await issueSessionToken(SECRET, invite.email, SESSION_TTL_DAYS * 86400, { tmp: true });
  setSessionCookie(c, session);
  return c.redirect("/");
});

app.get("/auth/logout", (c) => {
  deleteCookie(c, COOKIE, { path: "/" });
  return c.redirect("/");
});

app.get("/healthz", (c) => c.json({ ok: true }));

// Serve baked-in board-game covers (data/<note id>/cover.jpg).
app.get("/covers/:id", async (c) => {
  const id = c.req.param("id").replace(/[^0-9A-Za-z_-]/g, "");
  const f = Bun.file(join(COVERS_DIR, id, "cover.jpg"));
  if (!(await f.exists())) return c.notFound();
  return new Response(f, {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
  });
});

await loadConfig(WHITELIST_CONFIG_PATH).catch((err) => {
  console.error("Failed to load whitelist:", err);
  process.exit(1);
});

console.log(`board-games listening on :${PORT} (base ${BASE_URL})`);
export default { port: PORT, fetch: app.fetch };
