import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { coverKeyCandidates } from "../covers/keys.ts";
import type { GcsStore } from "./gcs.ts";

export interface FillGame {
  id: string;
  ludopediaId?: string;
  bggId?: string;
}

/** GCS object key for a game's cover from a given source, e.g. `<uuid>/bgg.jpg`. */
const sourceKey = (id: string, source: string) => `${id}/${source}.jpg`;

/** The source slug of a cache key like `bgg-2452` or `ludopedia-15950`. */
const sourceOf = (cacheKey: string) => cacheKey.split("-", 1)[0];

/**
 * Mirror every cached cover a game has — one per source (BGG and Ludopedia) —
 * into the private GCS bucket at `<uuid>/<source>.jpg`, so both sources' images
 * are archived and the sources are never hit again to serve them. The source
 * cover's sha256 (from its cover.json sidecar) is stored as object metadata; a
 * cover is (re)uploaded only when that sha differs from what's in GCS, so
 * unchanged covers aren't re-uploaded every cycle but upgrades are. Returns the
 * count uploaded.
 */
export async function uploadOriginals(games: FillGame[], coversDir: string, gcs: GcsStore): Promise<number> {
  let uploaded = 0;
  for (const g of games) {
    for (const cacheKey of coverKeyCandidates(g)) {
      const dir = join(coversDir, cacheKey);
      if (!existsSync(join(dir, "cover.jpg"))) continue;
      const sha = await coverSha(dir);
      const gcsKey = sourceKey(g.id, sourceOf(cacheKey));
      const existing = await gcs.metadata(gcsKey);
      if (existing && sha && existing.coverSha === sha) continue;
      await gcs.put(gcsKey, new Uint8Array(await readFile(join(dir, "cover.jpg"))), "image/jpeg", sha ? { coverSha: sha } : undefined);
      uploaded++;
    }
  }
  return uploaded;
}

/** sha256 of a cached cover, read from its cover.json sidecar (null if absent). */
async function coverSha(dir: string): Promise<string | null> {
  try {
    const meta = JSON.parse(await readFile(join(dir, "cover.json"), "utf8")) as { sha256?: string };
    return meta.sha256 ?? null;
  } catch {
    return null;
  }
}
