/**
 * Single-volume state. The worker writes; the app reads. Layout:
 *
 *   <root>/catalog.json     flattened Game array (atomic rewrite)
 *   <root>/users.json       roles config + permanent users
 *   <root>/tmp-users.jsonl  runtime temp users (app writes, worker ignores)
 *   <root>/covers/<key>/    cover cache (unchanged)
 *
 * All of it lives under one path so a single mounted volume persists everything.
 */
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Game } from "./games.ts";

export type RoleCapabilities = {
  canSeePrices?: boolean;
  canBid?: boolean;
  admin?: boolean;
};

export type RoleConfig = {
  defaultRole: string;
  roles: Record<string, RoleCapabilities>;
};

export type StoredUser = {
  identifier: string;
  role: string;
  password: string;
};

export type UsersFile = RoleConfig & {
  users: StoredUser[];
};

const TTL_MS = 30_000;

let catalogCache: { at: number; games: Game[] } | null = null;
let usersCache: { at: number; data: UsersFile } | null = null;

export function storePaths(root: string) {
  return {
    catalog: `${root}/catalog.json`,
    users: `${root}/users.json`,
    tmpUsers: `${root}/tmp-users.jsonl`,
    covers: `${root}/covers`,
    root,
  };
}

/** Atomic write: temp file + rename, so readers never see a half-written file. */
export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(data), "utf8");
  await rename(tmp, path);
}

export async function writeCatalog(root: string, games: Game[]): Promise<void> {
  await writeJsonAtomic(storePaths(root).catalog, games);
  catalogCache = { at: Date.now(), games };
}

export async function writeUsers(root: string, data: UsersFile): Promise<void> {
  await writeJsonAtomic(storePaths(root).users, data);
  usersCache = { at: Date.now(), data };
}

export async function loadCatalog(root: string, opts: { force?: boolean } = {}): Promise<Game[]> {
  if (!opts.force && catalogCache && Date.now() - catalogCache.at < TTL_MS) return catalogCache.games;
  try {
    const games = JSON.parse(await readFile(storePaths(root).catalog, "utf8")) as Game[];
    catalogCache = { at: Date.now(), games };
    return games;
  } catch {
    return [];
  }
}

export async function loadUsers(root: string, opts: { force?: boolean } = {}): Promise<UsersFile | null> {
  if (!opts.force && usersCache && Date.now() - usersCache.at < TTL_MS) return usersCache.data;
  try {
    const data = JSON.parse(await readFile(storePaths(root).users, "utf8")) as UsersFile;
    usersCache = { at: Date.now(), data };
    return data;
  } catch {
    return null;
  }
}
