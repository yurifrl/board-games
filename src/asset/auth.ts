import { createHmac, timingSafeEqual } from "node:crypto";
import type { AssetKey } from "./key.ts";
import { keyPath } from "./key.ts";

/**
 * Signed asset URLs (browser access) and bearer tokens (Hermes ingest + agent
 * reads). Signed URLs restrict image/rulebook links to ones our app minted;
 * the bearer token gates the write + agent-read APIs.
 */

/**
 * Signing secret: the dedicated ASSETS_SIGNING_SECRET if set, else the app's
 * AUTH_SECRET (same trust domain), else a dev-only fallback so `bun run` works
 * with no config. Production always has AUTH_SECRET.
 */
const secret = (): string =>
  process.env.ASSETS_SIGNING_SECRET || process.env.AUTH_SECRET || "dev-insecure-signing-secret";

/** Signature payload: the object path plus the size params and expiry. */
const payload = (path: string, w: string, h: string, exp: number): string => `${path}\n${w}\n${h}\n${exp}`;
const hmac = (data: string): string => createHmac("sha256", secret()).update(data).digest("hex");

/** Build a signed query string for an asset key (+ optional resize), valid `ttlSeconds`. */
export function sign(key: AssetKey, params: { w?: number; h?: number } = {}, ttlSeconds = 3600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const w = params.w != null ? String(params.w) : "";
  const h = params.h != null ? String(params.h) : "";
  const sig = hmac(payload(keyPath(key), w, h, exp));
  const q = new URLSearchParams();
  if (w) q.set("w", w);
  if (h) q.set("h", h);
  q.set("exp", String(exp));
  q.set("sig", sig);
  return q.toString();
}

/** Verify a request's signature over its object path + params + expiry. */
export function verifySigned(path: string, query: URLSearchParams): boolean {
  const sig = query.get("sig");
  const exp = Number(query.get("exp"));
  if (!sig || !Number.isFinite(exp)) return false;
  if (exp < Math.floor(Date.now() / 1000)) return false;
  const expected = hmac(payload(path, query.get("w") ?? "", query.get("h") ?? "", exp));
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** True when the request carries the shared asset bearer token (ingest + agent read). */
export function hasToken(authHeader: string | undefined): boolean {
  const token = process.env.ASSET_TOKEN;
  if (!token) return false;
  const got = authHeader?.replace(/^Bearer\s+/i, "");
  if (!got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
