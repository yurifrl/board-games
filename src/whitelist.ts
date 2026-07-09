import { timingSafeEqual } from "node:crypto";
import { loadUsers, type RoleConfig as StoredRoleConfig, type UsersFile } from "./store.ts";

/**
 * Roles + permanent users now live in a single `users.json` on the volume,
 * synced by the worker from `Users.md` in the Obsidian vault. Temp users
 * (runtime, admin-invited) stay in `tmp-users.jsonl` on the same volume.
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
  email: string;
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

function toRoleConfig(data: UsersFile): RoleConfig {
  return { defaultRole: data.defaultRole, roles: data.roles };
}

async function readUsers(dataDir: string): Promise<{ cfg: RoleConfig; users: Map<string, User> } | null> {
  const data = await loadUsers(dataDir);
  if (!data) return null;
  const cfg = toRoleConfig(data);
  const users = new Map<string, User>();
  for (const u of data.users) {
    users.set(u.identifier.toLowerCase(), { identifier: u.identifier.toLowerCase(), role: u.role, password: u.password });
  }
  return { cfg, users };
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
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export async function getPermission(dataDir: string, identifier: string): Promise<Permission | null> {
  const state = await readUsers(dataDir);
  if (!state) return null;
  const u = state.users.get(identifier.trim().toLowerCase());
  return u ? resolve(state.cfg, u.identifier, [u.role]) : null;
}

export async function authenticate(dataDir: string, identifier: string, password: string): Promise<Permission | null> {
  const state = await readUsers(dataDir);
  if (!state) return null;
  const u = state.users.get(identifier.trim().toLowerCase());
  const ok = safeEqual(password, u?.password ?? "\u0000never-matches\u0000");
  if (!u || !ok) return null;
  return resolve(state.cfg, u.identifier, [u.role]);
}

export async function listRoles(dataDir: string): Promise<string[]> {
  const state = await readUsers(dataDir);
  return state ? Object.keys(state.cfg.roles) : [];
}

export async function rolesExist(dataDir: string, roles: string[]): Promise<boolean> {
  const state = await readUsers(dataDir);
  if (!state) return false;
  return roles.every((r) => r in state.cfg.roles);
}

export async function resolveExplicit(dataDir: string, identifier: string, roles: string[]): Promise<Permission> {
  const state = await readUsers(dataDir);
  const cfg = state?.cfg ?? { defaultRole: "viewer", roles: {} };
  return resolve(cfg, identifier, roles);
}
