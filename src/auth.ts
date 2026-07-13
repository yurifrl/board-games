import { sign, verify } from "hono/jwt";

const ALG = "HS256" as const;

export type SessionClaims = {
  email: string;
  /** Marks a temporary (invited) user; their roles are resolved from the JSONL db. */
  tmp?: boolean;
  /** Marks a phone/WhatsApp user; permission resolved from the access-requests store. */
  phone?: boolean;
  /** Marks a Google user; permission resolved from the members store. */
  google?: boolean;
};

/**
 * Stateless session token: an HMAC-signed JWT stored in an httpOnly cookie.
 * Permanent users -> permissions from whitelist.json.
 * Temp users (tmp:true) -> permissions from the JSONL db, looked up each request.
 */
export async function issueSessionToken(
  secret: string,
  email: string,
  ttlSeconds: number,
  opts: { tmp?: boolean; phone?: boolean; google?: boolean } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = { sub: email.toLowerCase(), kind: "session", iat: now, exp: now + ttlSeconds };
  if (opts.tmp) payload.tmp = true;
  if (opts.phone) payload.phone = true;
  if (opts.google) payload.google = true;
  return sign(payload, secret, ALG);
}

export async function verifySession(secret: string, token: string): Promise<SessionClaims | null> {
  try {
    const p = await verify(token, secret, ALG);
    if (p.kind !== "session" || typeof p.sub !== "string") return null;
    return { email: p.sub, tmp: p.tmp === true, phone: p.phone === true, google: p.google === true };
  } catch {
    return null; // bad signature or expired
  }
}

/**
 * Admin-minted invite link credential. No expiry — the JSONL db is the source
 * of truth, so access is granted/revoked there, not by the token.
 */
export async function issueInviteToken(secret: string, email: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: email.toLowerCase(), kind: "invite", iat: now }, secret, ALG);
}

export async function verifyInvite(secret: string, token: string): Promise<{ email: string } | null> {
  try {
    const p = await verify(token, secret, ALG);
    if (p.kind !== "invite" || typeof p.sub !== "string") return null;
    return { email: p.sub };
  } catch {
    return null;
  }
}

/**
 * Phone "pass link" credential — the key the owner shares over WhatsApp after
 * approving a request. Access is governed by the access-requests store (approved
 * or not), so the token itself carries no expiry.
 */
export async function issuePassToken(secret: string, phone: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: phone, kind: "pass", iat: now }, secret, ALG);
}

export async function verifyPass(secret: string, token: string): Promise<{ phone: string } | null> {
  try {
    const p = await verify(token, secret, ALG);
    if (p.kind !== "pass" || typeof p.sub !== "string") return null;
    return { phone: p.sub };
  } catch {
    return null;
  }
}
