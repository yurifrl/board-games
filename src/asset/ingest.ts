import { Hono } from "hono";
import { createHash } from "node:crypto";
import type { AssetKey } from "./key.ts";
import { keyPath } from "./key.ts";
import type { AssetService } from "./service.ts";
import { hasToken } from "./auth.ts";

const EXT_BY_TYPE: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

const slug = (s: string) => s.replace(/[^0-9A-Za-z._-]/g, "-").replace(/^-+|-+$/g, "") || "upload";

/**
 * Push ingest. Hermes (or any holder of ASSET_TOKEN) POSTs a file for a game:
 *
 *   POST /ingest/:entity/:kind
 *   Authorization: Bearer <ASSET_TOKEN>
 *   X-Asset-Name: base-game-rules.pdf     (optional; becomes the variant)
 *   Content-Type: application/pdf
 *   <body = file bytes>
 *
 * Stored as `<entity>/<kind>/hermes/<name>.<ext>`. It only stores — no side
 * effects. The uploaded file's sha256 is its fingerprint.
 */
export function buildIngestRoute(service: AssetService): Hono {
  const app = new Hono();

  app.post("/ingest/:entity/:kind", async (c) => {
    if (!hasToken(c.req.header("authorization"))) return c.text("unauthorized", 401);

    const contentType = c.req.header("content-type") ?? "application/octet-stream";
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength === 0) return c.text("empty body", 400);

    const rawName = c.req.header("x-asset-name") ?? "upload";
    const dot = rawName.lastIndexOf(".");
    const nameExt = dot > 0 ? rawName.slice(dot + 1).toLowerCase() : undefined;
    const variant = slug(dot > 0 ? rawName.slice(0, dot) : rawName);
    const ext = nameExt ?? EXT_BY_TYPE[contentType] ?? "bin";

    const key: AssetKey = { entity: c.req.param("entity"), kind: c.req.param("kind"), source: "hermes", variant, ext };
    const fingerprint = createHash("sha256").update(bytes).digest("hex");
    await service.put(key, { bytes, contentType, fingerprint });

    return c.json({ stored: keyPath(key) }, 201);
  });

  return app;
}
