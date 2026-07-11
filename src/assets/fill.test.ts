import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uploadOriginals } from "./fill.ts";
import { GcsStore, type GcsBucketLike } from "./gcs.ts";

function fakeBucket() {
  const blobs = new Map<string, Buffer>();
  const bucket: GcsBucketLike = {
    file(key: string) {
      return {
        async exists(): Promise<[boolean]> { return [blobs.has(key)]; },
        async download(): Promise<[Buffer]> { return [blobs.get(key)!]; },
        async save(data: Buffer | Uint8Array) { blobs.set(key, Buffer.from(data)); },
      };
    },
  };
  return { bucket, blobs };
}

async function seedCover(coversDir: string, key: string) {
  await mkdir(join(coversDir, key), { recursive: true });
  await writeFile(join(coversDir, key, "cover.jpg"), Buffer.from([1, 2, 3]));
}

test("uploads best cover per game, skips no-provider and already-present", async () => {
  const coversDir = await mkdtemp(join(tmpdir(), "covers-"));
  await seedCover(coversDir, "ludopedia-15950"); // game A best cover
  await seedCover(coversDir, "bgg-2452");        // game C cover
  const { bucket, blobs } = fakeBucket();
  const gcs = new GcsStore(undefined, bucket);
  blobs.set("c/original.jpg", Buffer.from([9])); // C already in GCS -> skipped

  const games = [
    { id: "a", ludopediaId: "15950", bggId: "111" }, // uploaded (ludopedia preferred)
    { id: "b" },                                     // no provider id -> skipped
    { id: "c", bggId: "2452" },                      // already present -> skipped
  ];
  const n = await uploadOriginals(games, coversDir, gcs);
  expect(n).toBe(1);
  expect(blobs.has("a/original.jpg")).toBe(true);
  expect(blobs.has("b/original.jpg")).toBe(false);
});
