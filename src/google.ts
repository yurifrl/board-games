/**
 * Google Sign-In (OpenID Connect), passwordless. We never store a password —
 * Google proves identity and hands us a verified email + name. Authorization
 * (who's allowed) is decided separately in the members store.
 *
 * The id_token comes straight from Google's token endpoint over TLS, so we
 * trust its payload without re-verifying the signature via JWKS.
 */
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export const googleConfigured = (): boolean =>
  !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export function googleAuthUrl(redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  return `${AUTH_ENDPOINT}?${p.toString()}`;
}

export type GoogleIdentity = { email: string; name?: string; sub: string; emailVerified: boolean };

function decodeJwtPayload(idToken: string): Record<string, unknown> | null {
  const seg = idToken.split(".")[1];
  if (!seg) return null;
  try {
    const json = Buffer.from(seg.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export async function exchangeCode(code: string, redirectUri: string): Promise<GoogleIdentity | null> {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { id_token?: string };
  if (!json.id_token) return null;
  const p = decodeJwtPayload(json.id_token);
  const email = typeof p?.email === "string" ? p.email.toLowerCase() : null;
  if (!email || typeof p?.sub !== "string") return null;
  return {
    email,
    name: typeof p.name === "string" ? p.name : undefined,
    sub: p.sub,
    emailVerified: p.email_verified === true,
  };
}
