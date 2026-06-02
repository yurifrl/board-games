import { appendFile, readFile } from "node:fs/promises";

/**
 * A tiny append-only JSONL "database" for temporary users (no real DB).
 * Each line is one record. Reads apply last-wins per email, and a record with
 * `deleted: true` is a tombstone (revokes the user). This gives us mutable,
 * revocable temp users without a TTL.
 */
export type TmpUser = {
  email: string;
  roles: string[];
  createdAt: string;
  createdBy?: string;
  deleted?: boolean;
};

export async function loadTmpUsers(path: string): Promise<Map<string, TmpUser>> {
  let raw = "";
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return new Map(); // no file yet -> empty db
  }
  const map = new Map<string, TmpUser>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const rec = JSON.parse(trimmed) as TmpUser;
      if (!rec.email) continue;
      const key = rec.email.toLowerCase();
      if (rec.deleted) map.delete(key);
      else map.set(key, { ...rec, email: key });
    } catch {
      // skip malformed lines
    }
  }
  return map;
}

export async function getTmpUser(path: string, email: string): Promise<TmpUser | null> {
  const map = await loadTmpUsers(path);
  return map.get(email.trim().toLowerCase()) ?? null;
}

export async function upsertTmpUser(
  path: string,
  rec: { email: string; roles: string[]; createdBy?: string },
): Promise<void> {
  const line =
    JSON.stringify({
      email: rec.email.trim().toLowerCase(),
      roles: rec.roles,
      createdBy: rec.createdBy,
      createdAt: new Date().toISOString(),
    }) + "\n";
  await appendFile(path, line, "utf8");
}

/** Append a tombstone so the user can no longer sign in. */
export async function revokeTmpUser(path: string, email: string, by?: string): Promise<void> {
  const line =
    JSON.stringify({
      email: email.trim().toLowerCase(),
      roles: [],
      deleted: true,
      createdBy: by,
      createdAt: new Date().toISOString(),
    }) + "\n";
  await appendFile(path, line, "utf8");
}
