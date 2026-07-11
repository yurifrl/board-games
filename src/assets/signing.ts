import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed asset URLs. The web app mints a short-lived signature for an image
 * request; the assets API verifies it before serving. This restricts the
 * endpoint to URLs our own app produced — hotlinking or scraping a leaked URL
 * fails once it expires.
 *
 * Signature = HMAC-SHA256(secret, `${id}\n${w}\n${h}\n${exp}`), hex.
 */
export interface AssetParams {
  id: string;
  w?: number;
  h?: number;
}

const secret = (): string => {
  const s = process.env.ASSETS_SIGNING_SECRET;
  if (!s) throw new Error("ASSETS_SIGNING_SECRET is not set");
  return s;
};

const payload = (p: AssetParams, exp: number): string => `${p.id}\n${p.w ?? ""}\n${p.h ?? ""}\n${exp}`;

const hmac = (data: string): string => createHmac("sha256", secret()).update(data).digest("hex");

/** Build a signed query string (`?w=&h=&exp=&sig=`) valid for `ttlSeconds`. */
export function sign(p: AssetParams, ttlSeconds = 3600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = hmac(payload(p, exp));
  const q = new URLSearchParams();
  if (p.w != null) q.set("w", String(p.w));
  if (p.h != null) q.set("h", String(p.h));
  q.set("exp", String(exp));
  q.set("sig", sig);
  return q.toString();
}

/** Verify a request's params against its signature + expiry. */
export function verify(id: string, query: URLSearchParams): boolean {
  const sig = query.get("sig");
  const exp = Number(query.get("exp"));
  if (!sig || !Number.isFinite(exp)) return false;
  if (exp < Math.floor(Date.now() / 1000)) return false;
  const p: AssetParams = {
    id,
    w: query.get("w") ? Number(query.get("w")) : undefined,
    h: query.get("h") ? Number(query.get("h")) : undefined,
  };
  const expected = hmac(payload(p, exp));
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
