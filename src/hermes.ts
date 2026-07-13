import { createHmac } from "node:crypto";

/**
 * Fire-and-forget notification to the owner's phone via the Hermes webhook
 * adapter, using a `deliver_only: true` route (no LLM, sub-second push). Signed
 * with HMAC-SHA256 (X-Hub-Signature-256). Throttled so a login flood collapses
 * to at most one ping per window — the admin queue always holds the full list,
 * so a skipped ping loses nothing.
 *
 * ponytail: in-memory throttle; fine for a single app instance. Multiple
 * replicas would each keep their own window — move to a shared counter only if
 * you actually run >1 replica.
 */
const THROTTLE_MS = Number(process.env.HERMES_NOTIFY_THROTTLE_MS ?? "60000");
let lastSent = 0;

/** Send a plain notification. Never throws; never blocks the caller's response. */
export function notifyOwner(fields: Record<string, string | number>): void {
  const url = process.env.HERMES_WEBHOOK_URL;
  if (!url) {
    console.log("[notify]", JSON.stringify(fields));
    return;
  }
  const now = Date.now();
  if (now - lastSent < THROTTLE_MS) return; // flood guard
  lastSent = now;

  const body = JSON.stringify(fields);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const secret = process.env.HERMES_WEBHOOK_SECRET;
  if (secret) headers["X-Hub-Signature-256"] = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

  // Fire-and-forget: don't await, swallow errors — the login must not depend on it.
  fetch(url, { method: "POST", headers, body }).catch((e) => console.error("hermes notify failed:", (e as Error).message));
}
