import { Hono } from "hono";
import { AssetStore } from "./store.ts";
import { GcsStore } from "./gcs.ts";
import { resize } from "./resize.ts";
import { verify } from "./signing.ts";

const originalKey = (id: string) => `${id}/original.jpg`;

export interface AssetDeps {
  store: AssetStore;
  gcs: GcsStore;
  /** True when a game has a provider id, so the worker can still fill it. */
  isFillable: (id: string) => boolean | Promise<boolean>;
}

/**
 * Read-side handler. GET /:id?w=&h=&sig=&exp=
 *   verify sig+exp (401) -> local variant (200) -> GCS original: resize+cache (200)
 *   -> 202 (fillable, not yet synced) / 404 (no provider id, nothing will fill).
 */
export function buildAssetsRoute(deps: AssetDeps): Hono {
  const app = new Hono();
  // ponytail: in-memory negative cache; resets on restart, which is fine.
  const known404 = new Set<string>();

  app.get("/:id", async (c) => {
    const id = c.req.param("id").replace(/[^0-9A-Za-z-]/g, "");
    const query = new URL(c.req.url).searchParams;
    if (!verify(id, query)) return c.text("bad signature", 401);

    const w = query.get("w") ? Number(query.get("w")) : undefined;
    const h = query.get("h") ? Number(query.get("h")) : undefined;

    const cached = await deps.store.get(id, w, h);
    if (cached) return image(cached);

    let original = await deps.store.get(id);
    if (!original) {
      const fromGcs = await deps.gcs.get(originalKey(id));
      if (fromGcs) {
        await deps.store.put(id, fromGcs);
        original = fromGcs;
      }
    }

    if (!original) {
      if (known404.has(id) || !(await deps.isFillable(id))) {
        known404.add(id);
        return c.text("no image for this game", 404);
      }
      return c.text("not yet available", 202);
    }

    if (w == null && h == null) return image(original);
    const variant = await resize(original, w, h);
    await deps.store.put(id, variant, w, h);
    return image(variant);
  });

  return app;
}

const image = (bytes: Uint8Array): Response =>
  new Response(bytes, {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
  });
