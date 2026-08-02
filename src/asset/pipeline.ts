import { SourceUnavailableError, type AssetSource, type Entity } from "./types.ts";
import type { AssetService } from "./service.ts";

export type Outcome = "stored" | "unchanged" | "deferred" | "failed";

export interface PipelineResult {
  entity: string;
  source: string;
  kind: string;
  outcome: Outcome;
}

/**
 * Pull every source's assets for each entity into the store. Zero source-specific
 * branches: it loops the registered sources, asks each what it can provide, and
 * stores anything new or changed. Each source is hit at most once per asset
 * (fingerprint compare); a temporarily-unavailable source is deferred without
 * affecting the others. With `force`, the fingerprint check is skipped so every
 * asset is re-pulled from source and overwritten — the manual "fix everything"
 * path for stale/wrong covers. `concurrency` (default 1) processes that many
 * entities at once — used by the box-art generator to fan slow image calls out.
 */
export async function runPipeline(
  entities: Entity[],
  sources: AssetSource[],
  service: AssetService,
  onResult?: (r: PipelineResult) => void,
  opts: { force?: boolean; concurrency?: number } = {},
): Promise<PipelineResult[]> {
  const out: PipelineResult[] = [];
  const record = (r: PipelineResult) => {
    out.push(r);
    onResult?.(r);
  };

  const processEntity = async (e: Entity) => {
    for (const source of sources) {
      let discovered;
      try {
        discovered = await source.discover(e);
      } catch (err) {
        record({ entity: e.id, source: source.id, kind: source.kind, outcome: err instanceof SourceUnavailableError ? "deferred" : "failed" });
        continue;
      }
      for (const asset of discovered) {
        try {
          if (!opts.force && !(await service.needsUpdate(asset.key, asset.fingerprint))) {
            record({ entity: e.id, source: source.id, kind: asset.key.kind, outcome: "unchanged" });
            continue;
          }
          const blob = await asset.fetch();
          await service.put(asset.key, { ...blob, fingerprint: asset.fingerprint });
          record({ entity: e.id, source: source.id, kind: asset.key.kind, outcome: "stored" });
        } catch (err) {
          record({ entity: e.id, source: source.id, kind: asset.key.kind, outcome: err instanceof SourceUnavailableError ? "deferred" : "failed" });
        }
      }
    }
  };

  const concurrency = Math.max(1, opts.concurrency ?? 1);
  let next = 0;
  const worker = async () => {
    while (next < entities.length) await processEntity(entities[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, entities.length) }, worker));
  return out;
}
