import { expect, test } from "bun:test";
import { GcsStore, type GcsBucketLike } from "./gcs.ts";

function fakeBucket(): GcsBucketLike {
  const blobs = new Map<string, Buffer>();
  return {
    file(key: string) {
      return {
        async exists(): Promise<[boolean]> {
          return [blobs.has(key)];
        },
        async download(): Promise<[Buffer]> {
          return [blobs.get(key)!];
        },
        async save(data: Buffer | Uint8Array) {
          blobs.set(key, Buffer.from(data));
        },
      };
    },
  };
}

test("put -> head -> get round-trip", async () => {
  const store = new GcsStore(undefined, fakeBucket());
  const key = "uuid-1/original.jpg";
  expect(await store.head(key)).toBe(false);
  expect(await store.get(key)).toBeNull();
  await store.put(key, new Uint8Array([9, 8, 7]));
  expect(await store.head(key)).toBe(true);
  expect(await store.get(key)).toEqual(new Uint8Array([9, 8, 7]));
});
