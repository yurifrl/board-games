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
 * cover and are skipped. The source cover's sha256 (from its cover.json sidecar)
 * is stored as object metadata; a cover is (re)uploaded only when that sha
 * differs from what's in GCS — so unchanged covers aren't re-uploaded every
 * cycle, but upgrades (e.g. a low-res cover replaced by a full-res one) are.
 * Returns the count uploaded.
 */
export async function uploadOriginals(games: FillGame[], coversDir: string, gcs: GcsStore): Promise<number> {
  let uploaded = 0;
  for (const g of games) {
    const key = coverKeyCandidates(g).find((k) => existsSync(join(coversDir, k, "cover.jpg")));
    if (!key) continue;
    const sha = await coverSha(coversDir, key);
    const gcsKey = originalKey(g.id);
    const existing = await gcs.metadata(gcsKey);
    if (existing && sha && existing.coverSha === sha) continue;
    await gcs.put(gcsKey, new Uint8Array(await readFile(join(coversDir, key, "cover.jpg"))), "image/jpeg", sha ? { coverSha: sha } : undefined);
    uploaded++;
  }
  return uploaded;
}

/** sha256 of the cached cover, read from its cover.json sidecar (null if absent). */
async function coverSha(coversDir: string, key: string): Promise<string | null> {
  try {
    const meta = JSON.parse(await readFile(join(coversDir, key, "cover.json"), "utf8")) as { sha256?: string };
    return meta.sha256 ?? null;
  } catch {
    return null;
  }
}
