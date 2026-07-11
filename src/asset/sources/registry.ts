import type { AssetSource } from "../types.ts";
import { BggCoverSource, type BggConfig } from "./bgg-cover.ts";
import { LudopediaCoverSource, type LudopediaConfig } from "./ludopedia-cover.ts";

export interface SourcesConfig {
  bgg?: BggConfig;
  ludopedia?: LudopediaConfig;
}

/**
 * The complete set of pull sources. THIS is the only place you add a source —
 * a new site or asset kind is one new AssetSource here, no branching elsewhere.
 */
export function buildSources(cfg: SourcesConfig = {}): AssetSource[] {
  return [new BggCoverSource(cfg.bgg), new LudopediaCoverSource(cfg.ludopedia)];
}
