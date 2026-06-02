import { FsCoverStore } from "./store.ts";
import { CoverResolver } from "./resolver.ts";
import { BggImageProvider } from "./providers/bgg.ts";
import { LudopediaProvider, type LudopediaConfig } from "./providers/ludopedia.ts";

export type { GameRef, CoverProvider, CoverStore } from "./types.ts";
export { coverKey, coverKeyCandidates } from "./keys.ts";
export type { CoverSourceSlug } from "./keys.ts";
export { CoverResolver } from "./resolver.ts";
export type { SyncResult, Outcome } from "./resolver.ts";

export interface CoverPipelineConfig {
  coversDir: string;
  ludopedia?: LudopediaConfig;
}

/**
 * Wire the default cover pipeline: Ludopedia (tier 30, full-res) preferred,
 * BoardGameGeek image (tier 10, low-res) as the always-available fallback.
 * Add a provider here to extend the pipeline — nothing else needs to change.
 */
export function buildCoverResolver(cfg: CoverPipelineConfig): CoverResolver {
  const providers = [new LudopediaProvider(cfg.ludopedia), new BggImageProvider()];
  return new CoverResolver(providers, new FsCoverStore(cfg.coversDir));
}
