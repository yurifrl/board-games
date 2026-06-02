/**
 * Cover cache keys — the single source of truth for how a cached cover's
 * directory is named, shared by the sync tool (which writes) and the web app
 * (which serves). The cache is keyed by the **source** id, not the note id:
 *
 *   data/ludopedia-15950/cover.jpg     (a Ludopedia cover, tier 30)
 *   data/bgg-237182/cover.jpg          (a BoardGameGeek cover, tier 10)
 *
 * The source is part of the key because BGG and Ludopedia ids are both numeric
 * and would otherwise collide. Two notes pointing at the same game share one
 * cached cover.
 */

/** The source prefix used in a flat cache key `<source>-<id>`. */
export type CoverSourceSlug = "ludopedia" | "bgg";

/** Build a cache key from a source + that source's id. */
export const coverKey = (source: CoverSourceSlug, id: string | number): string => `${source}-${id}`;

/**
 * The cache keys a game could be served from, in descending quality tier
 * (Ludopedia preferred over BGG). A pure function of the note's source ids, so
 * the web app can pick which cover to serve without replaying the sync logic.
 */
export function coverKeyCandidates(g: { ludopediaId?: string; bggId?: string }): string[] {
  const out: string[] = [];
  if (g.ludopediaId) out.push(coverKey("ludopedia", g.ludopediaId));
  if (g.bggId) out.push(coverKey("bgg", g.bggId));
  return out;
}
