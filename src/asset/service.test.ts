import { expect, test } from "bun:test";
import type { AssetKey } from "./key.ts";
import { keyPath, variantKey } from "./key.ts";
import { InMemoryBlobStore } from "./store/memory.ts";
import { AssetService } from "./service.ts";
import type { AssetRenderer } from "./types.ts";

const base: AssetKey = { entity: "g1", kind: "cover", source: "bgg", variant: "original", ext: "jpg" };

// A renderer that "resizes" by prefixing bytes, variant from ?w=.
const doubler: AssetRenderer = {
  kind: "cover",
  variantName: (p) => (p.get("w") ? `${p.get("w")}w` : "original"),
  render: async (b) => ({ ...b, bytes: new Uint8Array([...b.bytes, ...b.bytes]) }),
};

function svc() {
  const origin = new InMemoryBlobStore();
  const cache = new InMemoryBlobStore();
  return { origin, cache, service: new AssetService(origin, cache, new Map([["cover", doubler]])) };
}

test("put writes both origin and cache", async () => {
  const { origin, cache, service } = svc();
  await service.put(base, { bytes: new Uint8Array([1]), contentType: "image/jpeg", fingerprint: "fp" });
  expect(await origin.head(base)).not.toBeNull();
  expect(await cache.head(base)).not.toBeNull();
});

test("needsUpdate reflects the origin fingerprint", async () => {
  const { service } = svc();
  expect(await service.needsUpdate(base, "fp1")).toBe(true); // absent
  await service.put(base, { bytes: new Uint8Array([1]), contentType: "image/jpeg", fingerprint: "fp1" });
  expect(await service.needsUpdate(base, "fp1")).toBe(false); // unchanged
  expect(await service.needsUpdate(base, "fp2")).toBe(true); // changed
});

test("render returns the original when no transform params", async () => {
  const { service } = svc();
  await service.put(base, { bytes: new Uint8Array([9]), contentType: "image/jpeg" });
  const out = await service.render(base, new URLSearchParams());
  expect(out?.bytes).toEqual(new Uint8Array([9]));
});

test("render derives, caches the variant, and reuses the cache", async () => {
  const { origin, cache, service } = svc();
  await service.put(base, { bytes: new Uint8Array([5]), contentType: "image/jpeg" });
  const params = new URLSearchParams("w=300");
  const out = await service.render(base, params);
  expect(out?.bytes).toEqual(new Uint8Array([5, 5])); // doubled
  // cached under the variant key, not re-derived from origin
  expect(await cache.get(variantKey(base, "300w"))).not.toBeNull();
  expect(keyPath(variantKey(base, "300w"))).toBe("g1/cover/bgg/300w.jpg");
});

test("render returns null when the original is missing", async () => {
  const { service } = svc();
  expect(await service.render(base, new URLSearchParams())).toBeNull();
});
