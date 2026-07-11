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
}

/**
 * Wire the asset platform. The durable origin is GCS when ASSETS_GCS_BUCKET is
 * set, otherwise local disk (so dev works without GCS); the cache is always
 * local disk under <dataDir>/assets.
 */
export function buildAssetPlatform(cfg: { dataDir: string } & SourcesConfig): AssetPlatform {
  const cache = new DiskBlobStore(join(cfg.dataDir, "assets"));
  const origin = process.env.ASSETS_GCS_BUCKET ? new GcsBlobStore() : cache;
  const service = new AssetService(origin, cache, buildRenderers());
  return {
    service,
    sources: buildSources({ ludopedia: cfg.ludopedia }),
    serve: buildAssetRoutes(service),
    ingest: buildIngestRoute(service),
  };
}
