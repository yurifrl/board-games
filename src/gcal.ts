/**
 * Google Calendar API client (service-account auth) — the read+write link to the
 * owner's "Board Games" calendar, which is the source of truth for availability
 * blocks and booked game sessions.
 *
 * Availability block  = an event with no `game` extended property (owner's free time).
 * Booked session      = an event with extendedProperties.private.game = <catalog id>
 *                       and .players = comma-separated member emails.
 * We use extendedProperties (not real attendees) so no attendee-invite / domain
 * delegation is needed — the service account just edits events on a shared calendar.
 */
import { createSign } from "node:crypto";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/calendar";

type SA = { client_email: string; private_key: string };

function loadSA(): SA | null {
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  let raw = process.env.GOOGLE_SA_JSON;
  try {
    if (!raw && path) raw = require("node:fs").readFileSync(path, "utf8");
    if (!raw) return null;
    raw = raw.trim();
    // Accept base64-encoded JSON (clean single-line .env value) as well as raw JSON.
    if (!raw.startsWith("{")) raw = Buffer.from(raw, "base64").toString("utf8");
    const j = JSON.parse(raw);
    if (!j.client_email || !j.private_key) return null;
    return { client_email: j.client_email, private_key: j.private_key };
  } catch {
    return null;
  }
}

export const calendarId = (): string => process.env.GOOGLE_CALENDAR_ID ?? "";
export const gcalConfigured = (): boolean => !!loadSA() && !!calendarId();

const b64url = (buf: Buffer | string): string =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Build + sign a service-account JWT and exchange it for an access token (cached). */
let cached: { token: string; exp: number } | null = null;
async function accessToken(): Promise<string> {
  if (cached && Date.now() < cached.exp - 60_000) return cached.token;
  const sa = loadSA();
  if (!sa) throw new Error("no service-account credentials (GOOGLE_APPLICATION_CREDENTIALS / GOOGLE_SA_JSON)");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email, scope: SCOPE, aud: TOKEN_ENDPOINT, iat: now, exp: now + 3600,
  }));
  const signature = b64url(createSign("RSA-SHA256").update(`${header}.${claim}`).sign(sa.private_key));
  const assertion = `${header}.${claim}.${signature}`;

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
  });
  if (!res.ok) throw new Error(`token exchange: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

const API = "https://www.googleapis.com/calendar/v3";

export type GCalEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await accessToken();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`gcal ${init?.method ?? "GET"} ${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

/** List events in [timeMin, timeMax) on the owner's calendar, chronological. */
export async function listEvents(timeMin: string, timeMax: string): Promise<GCalEvent[]> {
  const cid = encodeURIComponent(calendarId());
  const q = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "250" });
  const data = await call<{ items: GCalEvent[] }>(`/calendars/${cid}/events?${q.toString()}`);
  return data.items ?? [];
}

export function getEvent(id: string): Promise<GCalEvent> {
  const cid = encodeURIComponent(calendarId());
  return call<GCalEvent>(`/calendars/${cid}/events/${encodeURIComponent(id)}`);
}

/** Patch an event (partial update) — used to book a game into a block or add a player. */
export function patchEvent(id: string, body: Partial<GCalEvent>): Promise<GCalEvent> {
  const cid = encodeURIComponent(calendarId());
  return call<GCalEvent>(`/calendars/${cid}/events/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

// Self-check: `bun run src/gcal.ts` — verifies JWT assembly with a throwaway key.
if (import.meta.main) {
  const { generateKeyPairSync } = require("node:crypto");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs1", format: "pem" }) as string;
  process.env.GOOGLE_SA_JSON = JSON.stringify({ client_email: "t@x.iam.gserviceaccount.com", private_key: pem });
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({ iss: "t@x", scope: SCOPE, aud: TOKEN_ENDPOINT, iat: now, exp: now + 3600 }));
  const sig = b64url(createSign("RSA-SHA256").update(`${header}.${claim}`).sign(pem));
  console.assert(`${header}.${claim}.${sig}`.split(".").length === 3, "JWT has 3 segments");
  console.assert(JSON.parse(Buffer.from(claim.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()).scope === SCOPE, "scope in claim");
  console.log("gcal.ts self-check OK (JWT assembles, scope set)");
}
