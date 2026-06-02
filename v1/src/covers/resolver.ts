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
 * Orchestrates providers to fill the cover cache. For each game it tries
 * providers in descending quality tier, skipping anything already cached at an
 * equal-or-better tier (idempotent), upgrading when a better source is now
 * reachable, and falling back to a lower tier when a better one is temporarily
 * unavailable — without ever downgrading an existing good cover.
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
    const meta = await this.store.meta(game.id);
    const cachedTier = meta?.tier ?? -1;
    let deferred = false;

    for (const p of this.providers) {
      if (cachedTier >= p.tier) break; // nothing better remains to try
      try {
        const res = await p.fetch(game);
        if (res) {
          await this.store.write(game.id, res);
          return {
            id: game.id,
            name: game.name,
            outcome: meta ? "upgraded" : "fetched",
            source: res.source,
            tier: res.tier,
          };
        }
      } catch (e) {
        if (e instanceof ProviderUnavailableError) {
          deferred = true; // try a lower tier as a fallback, but keep retrying this one next run
          continue;
        }
        throw e;
      }
    }

    if (meta) {
      return { id: game.id, name: game.name, outcome: deferred ? "deferred" : "cached", source: meta.source, tier: meta.tier };
    }
    return { id: game.id, name: game.name, outcome: deferred ? "deferred" : "missing" };
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
