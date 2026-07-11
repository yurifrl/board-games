import { ProviderUnavailableError, type CoverProvider, type CoverStore, type GameRef } from "./types.ts";

export type Outcome = "cached" | "fetched" | "upgraded" | "deferred" | "missing";

export interface SyncResult {
  id: string;
  name: string;
  outcome: Outcome;
  source?: string;
  tier?: number;
  detail?: string;
}

/**
 * Orchestrates providers to fill the cover cache. To build a complete image
 * archive it fetches from EVERY provider that can serve a game (both BGG and
 * Ludopedia), storing each under its own source-keyed cache entry — so both
 * sources' covers are kept, not just the best one. Each source is hit at most
 * once: a cached cover is refetched only when its source fingerprint changed in
 * Obsidian (the image/id was edited). A temporarily-unavailable provider is
 * deferred to the next run without dropping the others.
 */
export class CoverResolver {
  private readonly providers: CoverProvider[];

  constructor(
    providers: CoverProvider[],
    private readonly store: CoverStore,
  ) {
    this.providers = [...providers].sort((a, b) => b.tier - a.tier);
  }

  async resolveOne(game: GameRef): Promise<SyncResult> {
    let fetched = false; // did we pull anything new this run
    let deferred = false;
    const have: { tier: number; source: string }[] = []; // covers present after this run

    for (const p of this.providers) {
      const key = p.keyFor(game);
      if (!key) continue;
      const m = await this.store.meta(key);
      const current = p.fingerprint(game);
      // A cached cover is current unless its source changed in Obsidian.
      const fresh = m != null && (current == null || m.sourceFingerprint === current);
      if (fresh) {
        have.push({ tier: m.tier, source: m.source });
        continue; // hit the source at most once
      }
      try {
        const res = await p.fetch(game);
        if (res) {
          await this.store.write(res.cacheKey, res);
          fetched = true;
          have.push({ tier: res.tier, source: res.source });
        }
      } catch (e) {
        if (e instanceof ProviderUnavailableError) {
          deferred = true; // retry this source next run; keep the others
          if (m) have.push({ tier: m.tier, source: m.source }); // fall back to the stale copy
          continue;
        }
        throw e;
      }
    }

    if (have.length === 0) {
      return { id: game.id, name: game.name, outcome: deferred ? "deferred" : "missing" };
    }
    const best = have.reduce((a, b) => (b.tier > a.tier ? b : a));
    const outcome: Outcome = fetched ? "fetched" : deferred ? "deferred" : "cached";
    return { id: game.id, name: game.name, outcome, source: best.source, tier: best.tier };
  }

  async sync(games: GameRef[], onResult?: (r: SyncResult) => void): Promise<SyncResult[]> {
    const out: SyncResult[] = [];
    for (const g of games) {
      const r = await this.resolveOne(g);
      out.push(r);
      onResult?.(r);
    }
    return out;
  }
}
