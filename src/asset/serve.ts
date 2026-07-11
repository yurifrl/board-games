import { Hono } from "hono";
import type { AssetKey } from "./key.ts";
import { keyPath } from "./key.ts";
import type { AssetService } from "./service.ts";
import { hasToken, verifySigned } from "./auth.ts";

/** Split a `<variant>.<ext>` filename into its parts. */
function splitFile(file: string): { variant: string; ext: string } | null {
  const dot = file.lastIndexOf(".");
  if (dot <= 0 || dot === file.length - 1) return null;
  return { variant: file.slice(0, dot), ext: file.slice(dot + 1) };
}

function keyFrom(c: { req: { param: (n: string) => string } }): AssetKey | null {
  const file = splitFile(c.req.param("file"));
  if (!file) return null;
  return {
    entity: c.req.param("entity"),
    kind: c.req.param("kind"),
    source: c.req.param("source"),
    variant: file.variant,
    ext: file.ext,
  };
}

const respond = (bytes: Uint8Array, contentType: string): Response =>
  new Response(bytes, { headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=86400" } });

/**
 * Read-side routes. Browsers use signed URLs; AI agents use the shared bearer
 * token. Both resolve an {@link AssetKey} from the path and render through the
 * same {@link AssetService} — covers get resized per ?w/?h, rulebooks (and any
 * kind without a renderer) are served byte-for-byte.
 */
export function buildAssetRoutes(service: AssetService): Hono {
  const app = new Hono();

  // Browser: signed URL, resize params allowed.
  app.get("/asset/:entity/:kind/:source/:file", async (c) => {
    const key = keyFrom(c);
    if (!key) return c.text("bad key", 400);
    const query = new URL(c.req.url).searchParams;
    if (!verifySigned(keyPath(key), query)) return c.text("bad signature", 401);
    const blob = await service.render(key, query);
    if (!blob) return c.text("not found", 404);
    return respond(blob.bytes, blob.contentType);
  });

  // Agent: list a game's assets (optionally by kind).
  app.get("/agent/:entity", async (c) => {
    if (!hasToken(c.req.header("authorization"))) return c.text("unauthorized", 401);
    const kind = c.req.query("kind");
    const keys = await service.list({ entity: c.req.param("entity"), kind });
    return c.json({ assets: keys.map((k) => ({ ...k, path: keyPath(k) })) });
  });

  // Agent: fetch one asset's bytes (originals; no resize needed for agents).
  app.get("/agent/:entity/:kind/:source/:file", async (c) => {
    if (!hasToken(c.req.header("authorization"))) return c.text("unauthorized", 401);
    const key = keyFrom(c);
    if (!key) return c.text("bad key", 400);
    const blob = await service.render(key, new URLSearchParams());
    if (!blob) return c.text("not found", 404);
    return respond(blob.bytes, blob.contentType);
  });

  return app;
}
