import { appendFile, readFile } from "node:fs/promises";
import { storePaths } from "./store.ts";

/**
 * Append-only JSONL store of slot signups (who's in which slot). Last-wins per
 * (slotId, phone); a `deleted: true` record is a tombstone (left the slot).
 * Capacity is a SOFT cap enforced on join (append + recount).
 * ponytail: soft cap — concurrent joins could exceed capacity by a hair; a hard
 * cap would need a per-file lock, not worth it at game-night scale.
 */
export type Signup = {
  slotId: string;
  phone: string;
  name?: string;
  gamePref?: string; // for open slots: the game this person wants to play
  createdAt: string;
  deleted?: boolean;
};

type Key = string;
const key = (slotId: string, phone: string): Key => `${slotId}\u0000${phone.toLowerCase()}`;

async function loadAll(dataDir: string): Promise<Map<Key, Signup>> {
  const map = new Map<Key, Signup>();
  let raw = "";
  try {
    raw = await readFile(storePaths(dataDir).signups, "utf8");
  } catch {
    return map;
  }
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const rec = JSON.parse(t) as Signup;
      if (!rec.slotId || !rec.phone) continue;
      const k = key(rec.slotId, rec.phone);
      if (rec.deleted) map.delete(k);
      else map.set(k, { ...rec, phone: rec.phone.toLowerCase() });
    } catch {
      // skip malformed
    }
  }
  return map;
}

/** Signup count per slotId. */
export async function signupCounts(dataDir: string): Promise<Map<string, number>> {
  const all = await loadAll(dataDir);
  const counts = new Map<string, number>();
  for (const s of all.values()) counts.set(s.slotId, (counts.get(s.slotId) ?? 0) + 1);
  return counts;
}

export async function isJoined(dataDir: string, slotId: string, phone: string): Promise<boolean> {
  const all = await loadAll(dataDir);
  return all.has(key(slotId, phone));
}

/** The slots a phone is currently signed up for. */
export async function slotsForPhone(dataDir: string, phone: string): Promise<Set<string>> {
  const all = await loadAll(dataDir);
  const out = new Set<string>();
  for (const s of all.values()) if (s.phone === phone.toLowerCase()) out.add(s.slotId);
  return out;
}

export async function join(
  dataDir: string,
  rec: { slotId: string; phone: string; name?: string; gamePref?: string },
): Promise<void> {
  const line = JSON.stringify({
    slotId: rec.slotId,
    phone: rec.phone.toLowerCase(),
    name: rec.name,
    gamePref: rec.gamePref,
    createdAt: new Date().toISOString(),
  }) + "\n";
  await appendFile(storePaths(dataDir).signups, line, "utf8");
}

export async function leave(dataDir: string, slotId: string, phone: string): Promise<void> {
  const line = JSON.stringify({
    slotId,
    phone: phone.toLowerCase(),
    deleted: true,
    createdAt: new Date().toISOString(),
  }) + "\n";
  await appendFile(storePaths(dataDir).signups, line, "utf8");
}
