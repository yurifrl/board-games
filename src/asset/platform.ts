import { join } from "node:path";
import { AssetService } from "./service.ts";
import { DiskBlobStore } from "./store/disk.ts";
import { GcsBlobStore } from "./store/gcs.ts";
import { buildRenderers } from "./render/registry.ts";
import { buildSources, type SourcesConfig } from "./sources/registry.ts";
import { buildAssetRoutes } from "./serve.ts";
import { buildIngestRoute } from "./ingest.ts";
import type { AssetSource } from "./types.ts";

export interface AssetPlatform {
  service: AssetService;
  sources: AssetSource[];
  serve: ReturnType<typeof buildAssetRoutes>;
  ingest: ReturnType<typeof buildIngestRoute>;
  /** True when a durable origin distinct from the local cache is configured
   * (GCS in prod, or ASSETS_ORIGIN_DIR as a local stand-in for dev). Drives the
   * admin's save / remove-from-durable controls. */
  tiered: boolean;
}

/**
 * Wire the asset platform. The durable origin is GCS when ASSETS_GCS_BUCKET is
 * set, a local disk dir when ASSETS_ORIGIN_DIR is set (dev stand-in for GCS),
 * otherwise the same local cache (single-tier dev). The cache is always local
 * disk under <dataDir>/assets.
 */
export function buildAssetPlatform(cfg: { dataDir: string } & SourcesConfig): AssetPlatform {
  const cache = new DiskBlobStore(join(cfg.dataDir, "assets"));
  const bucket = process.env.ASSETS_GCS_BUCKET;
  const originDir = process.env.ASSETS_ORIGIN_DIR;
  const tiered = !!bucket || !!originDir;
  const origin = bucket ? new GcsBlobStore() : originDir ? new DiskBlobStore(originDir) : cache;
  const service = new AssetService(origin, cache, buildRenderers(), tiered);
  return {
    service,
    sources: buildSources({ bgg: cfg.bgg, ludopedia: cfg.ludopedia }),
    serve: buildAssetRoutes(service, tiered),
    ingest: buildIngestRoute(service),
    tiered,
  };
}
