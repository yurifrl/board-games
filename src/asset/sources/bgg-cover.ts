import type { AssetBlob, AssetSource, DiscoveredAsset, Entity } from "../types.ts";

const UA = "Mozilla/5.0 Chrome/120";
const IMAGES_API = (picId: string) => `https://api.geekdo.com/api/images/${picId}`;

/** The pic id embedded in a geekdo image URL (`.../pic8907965.jpg`). */
export const picIdFromUrl = (url: string): string | null => url.match(/\/pic(\d+)\./)?.[1] ?? null;

/**
 * BoardGameGeek cover. The note stores a low-res grid thumbnail URL
 * (`image/grid`) that embeds the image's pic id; we resolve that to the
 * full-res `original` via the public geekdo images API (BGG's XML API is
 * 401-blocked). Fingerprinted by the grid URL, so a changed image in Obsidian
 * refetches. One asset: the cover original.
 */
export class BggCoverSource implements AssetSource {
  readonly id = "bgg";
  readonly kind = "cover";
  readonly priority = 20;

  async discover(e: Entity): Promise<DiscoveredAsset[]> {
    if (!e.bggId || !e.bggImageUrl) return [];
    const gridUrl = e.bggImageUrl;
    return [
      {
        key: { entity: e.id, kind: this.kind, source: this.id, variant: "original", ext: "jpg" },
        fingerprint: gridUrl,
        fetch: () => fetchBest(gridUrl),
      },
    ];
  }
}

async function fetchBest(gridUrl: string): Promise<AssetBlob> {
  const url = (await bestVariant(gridUrl)) ?? gridUrl;
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`bgg image ${r.status}`);
  return {
    bytes: new Uint8Array(await r.arrayBuffer()),
    contentType: r.headers.get("content-type") ?? "image/jpeg",
    fingerprint: gridUrl,
  };
}

/** Highest-resolution variant URL for a grid thumbnail, via the geekdo images API. */
async function bestVariant(gridUrl: string): Promise<string | null> {
  const picId = picIdFromUrl(gridUrl);
  if (!picId) return null;
  try {
    const r = await fetch(IMAGES_API(picId), { headers: { "User-Agent": UA } });
    if (!r.ok) return null;
    const d = (await r.json()) as { images?: Record<string, { url?: string }> };
    const imgs = d.images ?? (d as Record<string, { url?: string }>);
    return imgs.original?.url ?? imgs.large?.url ?? null;
  } catch {
    return null;
  }
}
