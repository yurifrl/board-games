import { loadCatalog } from "./store.ts";
import type { ProviderFacts, ProviderSnapshot } from "./worker/provider-data.ts";

// Game type + grouping live here. Note parsing moved to the worker (src/worker/parse.ts).

export type Game = {
  id: string;
  name: string;
  slug?: string;
  language?: string;
  type?: string;
  expansionOf?: string;
  price?: string;
  purchaseSource?: string;
  purchaseDate?: string;
  tags: string[];
  playTime?: number;
  played?: boolean;
  siteSize?: { widthCm: number; heightCm: number };
  urlBgg?: string;
  urlLudopedia?: string;
  bggId?: string;
  ludopediaId?: string;
  image?: string;
  /** Dominant cover color (#rrggbb) used to tint the 3D box + stage; set at sync. */
  tint?: string;
  /** True for actual games (excludes items tagged book / skip / tcg). */
  isGame: boolean;
  /** Purchase date as epoch ms (for sorting), or null when unknown/unparseable. */
  purchasedAt: number | null;
  forSale: boolean;
  salePrice?: string;
  notes?: string;
  facts?: ProviderFacts;
  providerData?: { bgg?: ProviderSnapshot; ludopedia?: ProviderSnapshot };
};

let cache: { at: number; games: Game[] } | null = null;
const TTL_MS = 60_000;

export async function loadGames(dataDir: string, opts: { force?: boolean } = {}): Promise<Game[]> {
  if (!opts.force && cache && Date.now() - cache.at < TTL_MS) return cache.games;
  const games = await loadCatalog(dataDir, opts);
  cache = { at: Date.now(), games };
  return games;
}

export type GameGroup = { base: Game; expansions: Game[] };

/**
 * Group expansions under their base game. An expansion (`type === "expansion"`)
 * is matched to a base whose `slug` equals its `expansion-of` (case-insensitive).
 * Expansions whose base game isn't in the collection are surfaced as their own
 * top-level entry so nothing is hidden.
 */
export function groupGames(games: Game[]): GameGroup[] {
  const isExpansion = (g: Game) => g.type === "expansion" && !!g.expansionOf;
  const baseBySlug = new Map<string, Game>();
  for (const g of games) {
    if (!isExpansion(g) && g.slug) baseBySlug.set(g.slug.toLowerCase(), g);
  }

  const groups = new Map<string, GameGroup>();
  const orderedTopLevel: Game[] = [];

  // Seed top-level entries (bases + standalone games) in sorted order.
  for (const g of games) {
    if (isExpansion(g)) continue;
    groups.set(g.id, { base: g, expansions: [] });
    orderedTopLevel.push(g);
  }

  // Attach expansions; orphans become their own top-level entry.
  for (const g of games) {
    if (!isExpansion(g)) continue;
    const base = baseBySlug.get(g.expansionOf!.toLowerCase());
    if (base) {
      groups.get(base.id)!.expansions.push(g);
    } else {
      groups.set(g.id, { base: g, expansions: [] });
      orderedTopLevel.push(g);
    }
  }

  // Default order: newest purchase first; unknown dates last, then by name.
  orderedTopLevel.sort((a, b) => {
    const ta = a.purchasedAt;
    const tb = b.purchasedAt;
    if (ta == null && tb == null) return a.name.localeCompare(b.name);
    if (ta == null) return 1;
    if (tb == null) return -1;
    return tb - ta || a.name.localeCompare(b.name);
  });
  const result = orderedTopLevel.map((g) => groups.get(g.id)!);
  for (const grp of result) {
    grp.expansions.sort((a, b) => a.name.localeCompare(b.name));
  }
  return result;
}
