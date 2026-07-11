import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uploadOriginals } from "./fill.ts";
import { GcsStore, type GcsBucketLike } from "./gcs.ts";

function fakeBucket() {
  const blobs = new Map<string, Buffer>();
  const metas = new Map<string, Record<string, string>>();
  const bucket: GcsBucketLike = {
    file(key: string) {
      return {
        async exists(): Promise<[boolean]> { return [blobs.has(key)]; },
        async download(): Promise<[Buffer]> { return [blobs.get(key)!]; },
        async save(data: Buffer | Uint8Array, opts?: { metadata?: { metadata?: Record<string, string> } }) {
          blobs.set(key, Buffer.from(data));
          if (opts?.metadata?.metadata) metas.set(key, opts.metadata.metadata);
        },
        async getMetadata(): Promise<[{ metadata?: Record<string, string> }]> {
          return [{ metadata: metas.get(key) }];
        },
      };
    },
  };
  return { bucket, blobs, metas };
}

async function seedCover(coversDir: string, key: string, sha: string) {
  await mkdir(join(coversDir, key), { recursive: true });
  await writeFile(join(coversDir, key, "cover.jpg"), Buffer.from([1, 2, 3]));
  await writeFile(join(coversDir, key, "cover.json"), JSON.stringify({ sha256: sha }));
}

test("uploads each source's cover, skips no-provider, skips unchanged, re-uploads on sha change", async () => {
  const coversDir = await mkdtemp(join(tmpdir(), "covers-"));
  await seedCover(coversDir, "ludopedia-15950", "sha-a"); // game A (ludopedia)
  await seedCover(coversDir, "bgg-2452", "sha-c-new");     // game C (bgg) upgraded
  const { bucket, blobs, metas } = fakeBucket();
  const gcs = new GcsStore(undefined, bucket);
  blobs.set("c/bgg.jpg", Buffer.from([0]));                // C already present...
  metas.set("c/bgg.jpg", { coverSha: "sha-c-old" });       // ...but OLD sha -> re-upload

  const games = [
    { id: "a", ludopediaId: "15950", bggId: "111" }, // ludopedia seeded -> a/ludopedia.jpg; bgg-111 not seeded -> skipped
    { id: "b" },                                     // no provider id -> skipped
    { id: "c", bggId: "2452" },                      // sha changed -> re-uploaded c/bgg.jpg
  ];
  const n = await uploadOriginals(games, coversDir, gcs);
  expect(n).toBe(2);
  expect(metas.get("a/ludopedia.jpg")?.coverSha).toBe("sha-a");
  expect(metas.get("c/bgg.jpg")?.coverSha).toBe("sha-c-new");
  expect(blobs.has("a/bgg.jpg")).toBe(false);
  expect(blobs.has("b/ludopedia.jpg")).toBe(false);

  // second run with no changes -> nothing re-uploaded
  expect(await uploadOriginals(games, coversDir, gcs)).toBe(0);
});
