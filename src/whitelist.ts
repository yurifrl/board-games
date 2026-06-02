import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { parse as parseYaml } from "yaml";

/**
 * Whitelist = merge of two sources:
 *   1. ROLE CONFIG (YAML, non-secret, from a ConfigMap): role -> capabilities,
 *      plus a configurable `defaultRole`.
 *   2. USERS (secret, one multiline blob): `role:identifier=password` per line,
 *      identifier being an email or name. A line with no `role:` prefix (or an
 *      unknown role) falls back to `defaultRole`. Passwords are plaintext and
 *      compared in constant time (the source is an encrypted Secret).
 */

export interface Capabilities {
  canSeePrices?: boolean;
  canBid?: boolean;
  admin?: boolean;
}

export interface RoleConfig {
  defaultRole: string;
  roles: Record<string, Capabilities>;
}

export interface Permission {
  email: string; // login identifier (email or name)
  name?: string;
  roles: string[];
  canSeePrices: boolean;
  canBid: boolean;
  admin: boolean;
}

interface User {
  identifier: string;
  role: string;
  password: string;
}

const CAP_KEYS = ["canSeePrices", "canBid", "admin"] as const;
// Secret keys that are NOT users (config/secret values sharing the same Secret).
// Secret keys that are NOT users (config/token values sharing the same Secret).
const RESERVED_KEYS = new Set([
  "notesPlain",
  "AUTH_SECRET",
  "WHATSAPP_NUMBER",
  "GITSYNC_PASSWORD",
  "GITHUB_TOKEN",
  "BOARDGAMES_TOKEN",
  "LUDOPEDIA_APP_ID",
  "LUDOPEDIA_APP_KEY",
  "LUDOPEDIA_ACESS_TOKEN",
  "LUDOPEDIA_ACCESS_TOKEN",
]);
const TTL_MS = 30_000;

let configCache: { at: number; cfg: RoleConfig } | null = null;
let usersCache: { at: number; users: Map<string, User> } | null = null;

export async function loadConfig(path: string): Promise<RoleConfig> {
  if (configCache && Date.now() - configCache.at < TTL_MS) return configCache.cfg;
  const cfg = parseYaml(await readFile(path, "utf8")) as RoleConfig;
  if (!cfg?.roles || typeof cfg.roles !== "object") throw new Error(`${path}: missing 'roles'`);
  if (!cfg.defaultRole) throw new Error(`${path}: missing 'defaultRole'`);
  configCache = { at: Date.now(), cfg };
  return cfg;
}

/**
 * Load users from the secret source. Two layouts are supported transparently:
 *   - a FILE: one line per user, `role:identifier=password`.
 *   - a DIRECTORY (mounted k8s Secret): one file per user, filename is the key
 *     (`role:identifier`, which k8s renders with `_` for `:`), content is the
 *     password.
 * Missing path -> empty (no permanent users).
 */
export async function loadUsers(path: string, cfg: RoleConfig): Promise<Map<string, User>> {
  if (usersCache && Date.now() - usersCache.at < TTL_MS) return usersCache.users;

  // Collect raw (key, password) pairs from whichever layout is present.
  const pairs: Array<{ key: string; password: string }> = [];
  try {
    const st = await stat(path);
    if (st.isDirectory()) {
      for (const name of await readdir(path)) {
        if (name.startsWith(".") || RESERVED_KEYS.has(name)) continue; // skip ..data, config keys, notes
        const password = (await readFile(join(path, name), "utf8")).replace(/\n$/, "");
        pairs.push({ key: name, password });
      }
    } else {
      for (const line of (await readFile(path, "utf8")).split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const eq = t.indexOf("=");
        if (eq === -1) continue;
        pairs.push({ key: t.slice(0, eq).trim(), password: t.slice(eq + 1) });
      }
    }
  } catch {
    // no users source yet
  }

  const users = new Map<string, User>();
  for (const { key, password } of pairs) {
    // Split the key into role + identifier on the first ':' or '_'.
    let role = cfg.defaultRole;
    let identifier = key;
    const m = key.match(/^([^:_]+)[:_](.+)$/);
    if (m && cfg.roles[m[1]]) {
      role = m[1];
      identifier = m[2];
    }
    identifier = identifier.trim().toLowerCase();
    if (identifier) users.set(identifier, { identifier, role, password });
  }
  usersCache = { at: Date.now(), users };
  return users;
}

function resolve(cfg: RoleConfig, identifier: string, roles: string[]): Permission {
  const perm: Permission = {
    email: identifier.toLowerCase(),
    roles,
    canSeePrices: false,
    canBid: false,
    admin: false,
  };
  for (const roleName of roles) {
    const role = cfg.roles[roleName];
    if (!role) continue;
    for (const cap of CAP_KEYS) if (role[cap]) perm[cap] = true;
  }
  if (perm.admin) {
    perm.canSeePrices = true;
    perm.canBid = true;
  }
  return perm;
}

/** Constant-time string compare (length-safe). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Still do a comparison to avoid trivial length-timing, then fail.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** Resolve a permission from a trusted session identifier (re-checked per request). */
export async function getPermission(configPath: string, usersPath: string, identifier: string): Promise<Permission | null> {
  const cfg = await loadConfig(configPath);
  const users = await loadUsers(usersPath, cfg);
  const u = users.get(identifier.trim().toLowerCase());
  return u ? resolve(cfg, u.identifier, [u.role]) : null;
}

export async function authenticate(
  configPath: string,
  usersPath: string,
  identifier: string,
  password: string,
): Promise<Permission | null> {
  const cfg = await loadConfig(configPath);
  const users = await loadUsers(usersPath, cfg);
  const u = users.get(identifier.trim().toLowerCase());
  // Compare even when the user is unknown to keep timing uniform.
  const ok = safeEqual(password, u?.password ?? "\u0000never-matches\u0000");
  if (!u || !ok) return null;
  return resolve(cfg, u.identifier, [u.role]);
}

export async function listRoles(configPath: string): Promise<string[]> {
  return Object.keys((await loadConfig(configPath)).roles);
}

export async function rolesExist(configPath: string, roles: string[]): Promise<boolean> {
  const cfg = await loadConfig(configPath);
  return roles.every((r) => r in cfg.roles);
}

/** Resolve capabilities for a temp (invited) user whose roles ride in the token. */
export async function resolveExplicit(configPath: string, identifier: string, roles: string[]): Promise<Permission> {
  return resolve(await loadConfig(configPath), identifier, roles);
}
