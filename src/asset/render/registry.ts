import type { AssetRenderer } from "../types.ts";
import { ImageRenderer } from "./image.ts";

/**
 * Renderers by asset kind. Anything without an entry (e.g. rulebooks) is served
 * byte-for-byte by the service's identity fallback. Add a kind's transform here.
 */
export function buildRenderers(): Map<string, AssetRenderer> {
  const image = new ImageRenderer();
  return new Map<string, AssetRenderer>([
    ["cover", image],
    ["spine", image],
    ["front", image],
    ["display", image],
  ]);
}
