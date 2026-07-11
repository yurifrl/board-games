import type { CoverProvider, CoverResult, GameRef } from "../types.ts";
import { coverKey } from "../keys.ts";

const UA = "Mozilla/5.0 Chrome/120";

/** Public geekdo image metadata API — returns every size variant for a pic id. */
const IMAGES_API = (picId: string) => `https://api.geekdo.com/api/images/${picId}`;

/** Extract the numeric pic id embedded in a geekdo image URL (`.../pic8907965.jpg`). */
export const picIdFromUrl = (url: string): string | null => url.match(/\/pic(\d+)\./)?.[1] ?? null;

/**
 * BoardGameGeek cover. The note stores a low-res grid thumbnail URL
 * (`image/grid`, 200x150). That URL embeds the image's pic id
 * (`.../pic8907965.jpg`), which we use to look up the **original** full-res
 * variant via the public geekdo images API (the BGG XML API is 401-blocked).
 * Falls back to `large`, then the grid URL itself, so it never regresses.
 *
 * Keyed by the note's `bgg/id`.
 */
export class BggImageProvider implements CoverProvider {
  readonly name = "bgg-image";
  // Full-res original; > the old tier 10 so the resolver upgrades cached
  // low-res covers, but < Ludopedia (30) which stays preferred.
  readonly tier = 20;

  keyFor(game: GameRef): string | null {
    return game.bggId ? coverKey("bgg", game.bggId) : null;
  }

  /** The note's stored BGG image URL — changes when the image changes in Obsidian. */
  fingerprint(game: GameRef): string | null {
    return game.bggImageUrl ?? null;
  }

  async fetch(game: GameRef): Promise<CoverResult | null> {
    if (!game.bggImageUrl || !game.bggId) return null;
    const url = (await this.bestVariant(game.bggImageUrl)) ?? game.bggImageUrl;
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (!r.ok) return null;
    return {
      bytes: new Uint8Array(await r.arrayBuffer()),
      contentType: r.headers.get("content-type") ?? "image/jpeg",
      source: this.name,
      tier: this.tier,
      sourceUrl: url,
      cacheKey: coverKey("bgg", game.bggId),
      fingerprint: game.bggImageUrl,
    };
  }

  /** Resolve the highest-resolution variant URL from a grid thumbnail URL. */
  private async bestVariant(gridUrl: string): Promise<string | null> {
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
}
