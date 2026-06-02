import type { CoverProvider, CoverResult, GameRef } from "../types.ts";
import { coverKey } from "../keys.ts";

/**
 * BoardGameGeek cover via the image URL already stored in the note
 * (`image/grid`). Public and unauthenticated, but low resolution — the
 * dependable fallback when nothing better is available. Keyed by the note's
 * `bgg/id`, so a `bgg/id` is required to cache it (the geekdo image URL carries
 * an opaque hash, not the game id).
 */
export class BggImageProvider implements CoverProvider {
  readonly name = "bgg-image";
  readonly tier = 10;

  keyFor(game: GameRef): string | null {
    return game.bggId ? coverKey("bgg", game.bggId) : null;
  }

  async fetch(game: GameRef): Promise<CoverResult | null> {
    if (!game.bggImageUrl || !game.bggId) return null;
    const r = await fetch(game.bggImageUrl);
    if (!r.ok) return null;
    return {
      bytes: new Uint8Array(await r.arrayBuffer()),
      contentType: r.headers.get("content-type") ?? "image/jpeg",
      source: this.name,
      tier: this.tier,
      sourceUrl: game.bggImageUrl,
      cacheKey: coverKey("bgg", game.bggId),
    };
  }
}
