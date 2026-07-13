import { Hono } from "hono";
import type { Context } from "hono";
import { join } from "node:path";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { groupGames, loadGames } from "./games.ts";
import {
  authenticate,
  getPermission,
  listRoles,
  resolveExplicit,
  rolesExist,
} from "./whitelist.ts";
import type { Permission } from "./whitelist.ts";
import {
  issueInviteToken,
  issuePassToken,
  issueSessionToken,
  verifyInvite,
  verifyPass,
  verifySession,
} from "./auth.ts";
import { getTmpUser, upsertTmpUser } from "./tmpusers.ts";
import { collectionPage, invitePage, slotPage, requestSentPage, membersAdminPage, pendingPage, deniedPage } from "./views.tsx";
import { loadUpcomingSlots, getSlotView } from "./slots.ts";
import { join as joinSlot, leave as leaveSlot, slotsForPhone, isJoined } from "./signups.ts";
import { request as requestAccess, approve as approveAccess, deny as denyAccess, getRequest, listRequests, normPhone } from "./access.ts";
import { googleConfigured, googleAuthUrl, exchangeCode } from "./google.ts";
import { requestMember, approveMember, denyMember, getMember, listMembers, normEmail } from "./members.ts";
import { notifyOwner } from "./hermes.ts";
import { randomBytes } from "node:crypto";
import { buildAssetPlatform } from "./asset/platform.ts";

const env = (k: string, d?: string): string => process.env[k] ?? d ?? "";

const SECRET = env("AUTH_SECRET");
if (!SECRET || SECRET === "change-me-to-a-32-byte-random-hex") {
  console.warn("⚠️  AUTH_SECRET is unset or default. Set a strong secret in production.");
}

const BASE_URL = env("BASE_URL", "http://localhost:3000");
const SESSION_TTL_DAYS = Number(env("SESSION_TTL_DAYS", "7"));
const DEFAULT_INVITE_ROLE = env("DEFAULT_INVITE_ROLE", "buyer");
const DATA_DIR = env("DATA_DIR", "./data");
const TMP_USERS_PATH = env("TMP_USERS_PATH", `${DATA_DIR}/tmp-users.jsonl`);
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
    return resolveExplicit(DATA_DIR, claims.email, tu.roles);
  }
  // Phone/WhatsApp users: permission resolved from the access-requests store.
  if (claims.phone) {
    const req = await getRequest(DATA_DIR, claims.email);
    if (!req || req.status !== "approved") return null;
    return resolveExplicit(DATA_DIR, claims.email, [req.role ?? "player"]);
  }
  // Google users: permission resolved from the members store (approve-on-first-sign-in).
  if (claims.google) {
    const m = await getMember(DATA_DIR, claims.email);
    if (!m || m.status !== "approved") return null;
    const perm = await resolveExplicit(DATA_DIR, claims.email, [m.role ?? "player"]);
    return { ...perm, name: m.name ?? perm.name };
  }
  // Permanent users: re-check the whitelist every request so revocation is immediate.
  return getPermission(DATA_DIR, claims.email);
}

/** Render the public collection, optionally with the login modal overlaid. */
async function renderHome(c: Context, login?: { error?: string }, status = 200) {
  const perm = await currentUser(c);
  const isAuthed = !!perm;
  const effective = perm ?? PUBLIC_PERM;
  const showAll = c.req.query("show") === "all";
  const all = await loadGames(DATA_DIR);
  const games = showAll ? all : all.filter((g) => g.isGame);
  const hiddenCount = all.length - games.length;
  const groups = groupGames(games);
  const roles = await listRoles(DATA_DIR);
  const slots = await loadUpcomingSlots(DATA_DIR);
  const mineSlots = perm ? await slotsForPhone(DATA_DIR, perm.email) : new Set<string>();
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
    showAll,
    hiddenCount,
    slots,
    mineSlots,
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
  const perm = await authenticate(DATA_DIR, email, password);
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
  if (role === "admin" || !(await rolesExist(DATA_DIR, [role]))) {
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

// ---- Google Sign-In + approve-on-first-sign-in members queue ----

app.get("/auth/google", async (c) => {
  if (!googleConfigured()) return renderHome(c, { error: "Google sign-in isn't configured." }, 500);
  const state = randomBytes(16).toString("hex");
  setCookie(c, "g_state", state, { httpOnly: true, secure: SECURE, sameSite: "Lax", path: "/", maxAge: 600 });
  // Remember the slot they were claiming so we can auto-join it after approval.
  const slot = c.req.query("slot");
  if (slot) setCookie(c, "g_slot", slot, { httpOnly: true, secure: SECURE, sameSite: "Lax", path: "/", maxAge: 600 });
  return c.redirect(googleAuthUrl(`${BASE_URL}/auth/google/callback`, state));
});

app.get("/auth/google/callback", async (c) => {
  const state = c.req.query("state");
  const cookieState = getCookie(c, "g_state");
  deleteCookie(c, "g_state", { path: "/" });
  if (!state || state !== cookieState) return renderHome(c, { error: "Sign-in expired, try again." }, 400);

  const code = c.req.query("code");
  if (!code) return c.redirect("/");
  const id = await exchangeCode(code, `${BASE_URL}/auth/google/callback`);
  if (!id || !id.emailVerified) return renderHome(c, { error: "Could not verify your Google account." }, 401);

  // Always issue the session (identity is proven); permission is gated by member status.
  setSessionCookie(c, await issueSessionToken(SECRET, id.email, SESSION_TTL_DAYS * 86400, { google: true }));

  // The slot they clicked "I want to play" on before logging in (if any).
  const wantSlot = getCookie(c, "g_slot");
  if (wantSlot) deleteCookie(c, "g_slot", { path: "/" });

  const existing = await getMember(DATA_DIR, id.email);
  if (existing?.status === "approved") {
    // Auto-claim the date they came in to book.
    if (wantSlot) {
      const slot = await getSlotView(DATA_DIR, wantSlot);
      if (slot && !(await isJoined(DATA_DIR, slot.id, id.email))) {
        await joinSlot(DATA_DIR, { slotId: slot.id, phone: id.email, name: id.name });
      }
    }
    return c.redirect("/");
  }
  if (existing?.status === "denied") return c.html(deniedPage(), 403);

  // First time (or still pending): record + ping the owner (throttled, no LLM).
  await requestMember(DATA_DIR, id.email, id.name);
  const pending = (await listMembers(DATA_DIR)).filter((m) => m.status === "pending").length;
  notifyOwner({
    name: id.name ?? id.email,
    email: id.email,
    count: pending,
    url: `${BASE_URL}/admin/requests`,
  });
  return c.html(pendingPage({ name: id.name }));
});

// Admin: review member requests, approve/deny.
app.get("/admin/requests", async (c) => {
  const perm = await currentUser(c);
  if (!perm?.admin) return c.text("Forbidden", 403);
  return c.html(membersAdminPage({ members: await listMembers(DATA_DIR) }));
});

app.post("/admin/requests/approve", async (c) => {
  const perm = await currentUser(c);
  if (!perm?.admin) return c.text("Forbidden", 403);
  const form = await c.req.parseBody();
  const email = normEmail(String(form["email"] ?? ""));
  if (email) await approveMember(DATA_DIR, email);
  return c.redirect("/admin/requests");
});

app.post("/admin/requests/deny", async (c) => {
  const perm = await currentUser(c);
  if (!perm?.admin) return c.text("Forbidden", 403);
  const form = await c.req.parseBody();
  const email = normEmail(String(form["email"] ?? ""));
  if (email) await denyMember(DATA_DIR, email);
  return c.redirect("/admin/requests");
});

// ---- Play: game slots synced from the calendar (shown on home; shareable per slot) ----

app.get("/slot/:id", async (c) => {
  const perm = await currentUser(c);
  const slot = await getSlotView(DATA_DIR, c.req.param("id"));
  if (!slot) return c.notFound();
  const mine = perm ? await isJoined(DATA_DIR, slot.id, perm.email) : false;
  return c.html(slotPage({ slot, authed: !!perm, mine }));
});

app.post("/slot/:id/join", async (c) => {
  const perm = await currentUser(c);
  if (!perm) return c.redirect("/");
  const slot = await getSlotView(DATA_DIR, c.req.param("id"));
  if (!slot) return c.notFound();
  // No hard cap: extra players are accepted (waitlist). Just dedupe.
  if (!(await isJoined(DATA_DIR, slot.id, perm.email))) {
    const form = await c.req.parseBody();
    const gamePref = String(form["gamePref"] ?? "").trim() || undefined;
    await joinSlot(DATA_DIR, { slotId: slot.id, phone: perm.email, name: perm.name, gamePref });
  }
  return c.redirect("/");
});

app.post("/slot/:id/leave", async (c) => {
  const perm = await currentUser(c);
  if (!perm) return c.redirect("/");
  await leaveSlot(DATA_DIR, c.req.param("id"), perm.email);
  return c.redirect("/");
});

// Public: submit a WhatsApp number to request access. Approved -> log in now.
app.post("/access/request", async (c) => {
  const form = await c.req.parseBody();
  const phone = normPhone(String(form["phone"] ?? ""));
  const name = String(form["name"] ?? "").trim() || undefined;
  if (!phone) return c.redirect("/");
  const existing = await getRequest(DATA_DIR, phone);
  if (existing?.status === "approved") {
    setSessionCookie(c, await issueSessionToken(SECRET, phone, SESSION_TTL_DAYS * 86400, { phone: true }));
    return c.redirect("/");
  }
  await requestAccess(DATA_DIR, { phone, name });
  return c.html(requestSentPage({ phone, ownerWa: WHATSAPP, approved: false }));
});

// Redeem a phone pass link (owner-shared) -> phone session, if still approved.
app.get("/auth/pass", async (c) => {
  const token = c.req.query("token") ?? "";
  const pass = await verifyPass(SECRET, token);
  if (!pass) return c.redirect("/");
  const req = await getRequest(DATA_DIR, pass.phone);
  if (!req || req.status !== "approved") return c.redirect("/");
  setSessionCookie(c, await issueSessionToken(SECRET, pass.phone, SESSION_TTL_DAYS * 86400, { phone: true }));
  return c.redirect("/");
});

app.get("/healthz", (c) => c.json({ ok: true }));

app.get("/styles.css", async (c) => {
  const f = Bun.file(join(import.meta.dir, "public", "styles.css"));
  return new Response(f, {
    headers: { "Content-Type": "text/css", "Cache-Control": "no-cache" },
  });
});

app.get("/mock.html", async () => {
  const f = Bun.file(join(import.meta.dir, "public", "mock.html"));
  return new Response(f, { headers: { "Content-Type": "text/html" } });
});

// Assets: covers (pulled from BGG/Ludopedia) + rulebooks (pushed by agents).
// Browser reads via signed URLs; agents read + ingest via the shared token.
const assets = buildAssetPlatform({
  dataDir: DATA_DIR,
  ludopedia: { token: env("LUDOPEDIA_ACCESS_TOKEN"), cookie: env("LUDOPEDIA_COOKIE") },
});
app.route("/", assets.serve);
app.route("/", assets.ingest);

console.log(`board-games listening on :${PORT} (base ${BASE_URL}, data ${DATA_DIR})`);
export default { port: PORT, fetch: app.fetch };
