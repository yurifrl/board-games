import { appendFile, readFile } from "node:fs/promises";
import { storePaths } from "./store.ts";

/**
 * Append-only JSONL store of members (people who signed in with Google).
 * Approve-on-first-sign-in: a Google login with an unknown email lands here as
 * `pending`; the owner flips it to `approved` (or `denied`). Last-wins per email.
 * No passwords — Google is the identity, this is just the allow decision.
 */
export type MemberStatus = "pending" | "approved" | "denied";

export type Member = {
  email: string;
  name?: string;
  status: MemberStatus;
  role?: string;
  createdAt: string;
};

export const normEmail = (s: string): string => s.trim().toLowerCase();

async function loadAll(dataDir: string): Promise<Map<string, Member>> {
  const map = new Map<string, Member>();
  let raw = "";
  try {
    raw = await readFile(storePaths(dataDir).members, "utf8");
  } catch {
    return map;
  }
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const rec = JSON.parse(t) as Member;
      if (rec.email) map.set(normEmail(rec.email), rec);
    } catch {
      // skip malformed
    }
  }
  return map;
}

export async function listMembers(dataDir: string): Promise<Member[]> {
  const all = await loadAll(dataDir);
  return [...all.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getMember(dataDir: string, email: string): Promise<Member | null> {
  const all = await loadAll(dataDir);
  return all.get(normEmail(email)) ?? null;
}

async function append(dataDir: string, rec: Member): Promise<void> {
  await appendFile(storePaths(dataDir).members, JSON.stringify(rec) + "\n", "utf8");
}

/** Record a first-time sign-in as pending (keeps an existing decision). Returns the current member. */
export async function requestMember(dataDir: string, email: string, name?: string): Promise<Member> {
  const e = normEmail(email);
  const existing = await getMember(dataDir, e);
  if (existing) {
    // Keep the existing decision; just refresh the name if we learned one.
    if (name && existing.name !== name && existing.status === "pending") {
      const updated = { ...existing, name };
      await append(dataDir, updated);
      return updated;
    }
    return existing;
  }
  const rec: Member = { email: e, name, status: "pending", createdAt: new Date().toISOString() };
  await append(dataDir, rec);
  return rec;
}

export async function approveMember(dataDir: string, email: string, role = "player"): Promise<void> {
  const e = normEmail(email);
  const existing = await getMember(dataDir, e);
  await append(dataDir, { email: e, name: existing?.name, status: "approved", role, createdAt: new Date().toISOString() });
}

export async function denyMember(dataDir: string, email: string): Promise<void> {
  const e = normEmail(email);
  const existing = await getMember(dataDir, e);
  await append(dataDir, { email: e, name: existing?.name, status: "denied", createdAt: new Date().toISOString() });
}
