import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { CoverMeta, CoverResult, CoverStore } from "./types.ts";

/**
 * Filesystem cover cache. Layout (one dir per source-keyed cover):
 *   <root>/<source>-<id>/cover.jpg   — the image bytes (what the web app serves)
 *   <root>/<source>-<id>/cover.json  — CoverMeta sidecar (source, tier, sha, ...)
 *
 * The key is `<source>-<id>` (e.g. `ludopedia-15950`, `bgg-237182`) — see
 * keys.ts. This directory IS the cache: once populated and committed, the
 * running app reads only from here and never touches a remote.
 */
export class FsCoverStore implements CoverStore {
  constructor(private readonly root: string) {}

  private dir(key: string) {
    return join(this.root, key);
  }
  private imagePath(key: string) {
    return join(this.dir(key), "cover.jpg");
  }
  private metaPath(key: string) {
    return join(this.dir(key), "cover.json");
  }

  async has(id: string): Promise<boolean> {
    return existsSync(this.imagePath(id));
  }

  async meta(id: string): Promise<CoverMeta | null> {
    if (!existsSync(this.imagePath(id))) return null;
    try {
      return JSON.parse(await readFile(this.metaPath(id), "utf8")) as CoverMeta;
    } catch {
      // Image present without a sidecar (e.g. legacy download): treat as tier 0
      // so any real provider can upgrade it on the next run.
      return { source: "unknown", tier: 0, sourceUrl: "", contentType: "image/jpeg", bytes: 0, sha256: "", fetchedAt: "" };
    }
  }

  async write(id: string, result: CoverResult): Promise<CoverMeta> {
    await mkdir(this.dir(id), { recursive: true });
    const sha256 = createHash("sha256").update(result.bytes).digest("hex");
    const meta: CoverMeta = {
      source: result.source,
      tier: result.tier,
      sourceUrl: result.sourceUrl,
      contentType: result.contentType,
      bytes: result.bytes.byteLength,
      sha256,
      fetchedAt: new Date().toISOString(),
    };
    await writeFile(this.imagePath(id), result.bytes);
    await writeFile(this.metaPath(id), JSON.stringify(meta, null, 2));
    return meta;
  }
}
