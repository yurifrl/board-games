import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssetStore } from "./store.ts";

test("variant key layout", () => {
  expect(AssetStore.variant()).toBe("original.jpg");
  expect(AssetStore.variant(300, 300)).toBe("300x300.jpg");
  expect(AssetStore.variant(300)).toBe("300x.jpg");
});

test("put -> has -> get round-trip", async () => {
  const root = await mkdtemp(join(tmpdir(), "assets-"));
  const store = new AssetStore(root);
  const bytes = new Uint8Array([1, 2, 3, 4]);
  expect(store.has("uuid-1", 300, 300)).toBe(false);
  await store.put("uuid-1", bytes, 300, 300);
  expect(store.has("uuid-1", 300, 300)).toBe(true);
  expect(await store.get("uuid-1", 300, 300)).toEqual(bytes);
  expect(await store.get("uuid-1")).toBeNull();
});
