import { appendFile, readFile } from "node:fs/promises";
import { storePaths } from "./store.ts";

/**
 * Append-only JSONL store of phone/WhatsApp access requests. Last-wins per phone;
 * status moves pending -> approved | denied. An approved record is what lets a
 * phone session resolve to a real user (role from `role`, default "player").
 */
export type AccessStatus = "pending" | "approved" | "denied";

export type AccessRequest = {
  phone: string;
  name?: string;
  message?: string;
  status: AccessStatus;
  role?: string;
  createdAt: string;
};

/** Normalize a WhatsApp number to digits only (keeps a leading country code). */
export const normPhone = (s: string): string => s.replace(/[^0-9]/g, "");

async function loadAll(dataDir: string): Promise<Map<string, AccessRequest>> {
  const map = new Map<string, AccessRequest>();
  let raw = "";
  try {
    raw = await readFile(storePaths(dataDir).accessRequests, "utf8");
  } catch {
    return map;
  }
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const rec = JSON.parse(t) as AccessRequest;
      if (!rec.phone) continue;
      map.set(rec.phone, rec);
    } catch {
      // skip malformed
    }
  }
  return map;
}

export async function listRequests(dataDir: string): Promise<AccessRequest[]> {
  const all = await loadAll(dataDir);
  return [...all.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getRequest(dataDir: string, phone: string): Promise<AccessRequest | null> {
  const all = await loadAll(dataDir);
  return all.get(normPhone(phone)) ?? null;
}

async function append(dataDir: string, rec: AccessRequest): Promise<void> {
  await appendFile(storePaths(dataDir).accessRequests, JSON.stringify(rec) + "\n", "utf8");
}

/** Create a pending request (idempotent-ish: keeps an existing approved status). */
export async function request(
  dataDir: string,
  rec: { phone: string; name?: string; message?: string },
): Promise<AccessRequest> {
  const phone = normPhone(rec.phone);
  const existing = await getRequest(dataDir, phone);
  if (existing && existing.status === "approved") return existing;
  const out: AccessRequest = {
    phone,
    name: rec.name,
    message: rec.message,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  await append(dataDir, out);
  return out;
}

export async function approve(dataDir: string, phone: string, role = "player"): Promise<AccessRequest> {
  const p = normPhone(phone);
  const existing = await getRequest(dataDir, p);
  const out: AccessRequest = {
    phone: p,
    name: existing?.name,
    message: existing?.message,
    status: "approved",
    role,
    createdAt: new Date().toISOString(),
  };
  await append(dataDir, out);
  return out;
}

export async function deny(dataDir: string, phone: string): Promise<void> {
  const p = normPhone(phone);
  const existing = await getRequest(dataDir, p);
  await append(dataDir, {
    phone: p,
    name: existing?.name,
    status: "denied",
    createdAt: new Date().toISOString(),
  });
}
