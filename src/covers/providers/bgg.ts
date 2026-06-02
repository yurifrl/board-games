import type { CoverProvider, CoverResult, GameRef } from "../types.ts";

/**
 * BoardGameGeek cover via the image URL already stored in the note
 * (`image/grid`). Public and unauthenticated, but low resolution — the
 * dependable fallback when nothing better is available.
 */
export class BggImageProvider implements CoverProvider {
  readonly name = "bgg-image";
  readonly tier = 10;

  async fetch(game: GameRef): Promise<CoverResult | null> {
    if (!game.bggImageUrl) return null;
    const r = await fetch(game.bggImageUrl);
    if (!r.ok) return null;
    return {
      bytes: new Uint8Array(await r.arrayBuffer()),
      contentType: r.headers.get("content-type") ?? "image/jpeg",
      source: this.name,
      tier: this.tier,
      sourceUrl: game.bggImageUrl,
    };
  }
}
