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

const originalKey = (id: string) => `${id}/original.jpg`;

/**
 * Mirror each game's best cached cover into the private GCS bucket, keyed by the
 * game's Obsidian UUID (`<id>/original.jpg`). Games with no provider id have no
 * cover and are skipped; anything already in GCS is left alone (idempotent, so
 * re-running the worker doesn't re-upload). Returns the count uploaded.
 */
export async function uploadOriginals(games: FillGame[], coversDir: string, gcs: GcsStore): Promise<number> {
  let uploaded = 0;
  for (const g of games) {
    const key = coverKeyCandidates(g).find((k) => existsSync(join(coversDir, k, "cover.jpg")));
    if (!key) continue;
    const gcsKey = originalKey(g.id);
    if (await gcs.head(gcsKey)) continue;
    await gcs.put(gcsKey, new Uint8Array(await readFile(join(coversDir, key, "cover.jpg"))));
    uploaded++;
  }
  return uploaded;
}
