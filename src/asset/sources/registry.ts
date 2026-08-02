import type { AssetSource } from "../types.ts";
import { BggCoverSource, type BggConfig } from "./bgg-cover.ts";
import { LudopediaCoverSource, type LudopediaConfig } from "./ludopedia-cover.ts";

export interface SourcesConfig {
  bgg?: BggConfig;
  ludopedia?: LudopediaConfig;
}

/**
 * The complete set of pull sources run by the regular sync. Generated box art
 * is deliberately NOT here — it runs on demand from src/worker/gen-box-art.ts
 * so a routine sync never triggers (paid) image generation.
 */
export function buildSources(cfg: SourcesConfig = {}): AssetSource[] {
  return [new BggCoverSource(cfg.bgg), new LudopediaCoverSource(cfg.ludopedia)];
}
