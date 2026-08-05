import { expect, test } from "bun:test";
import { AssetService } from "./service.ts";
import { InMemoryBlobStore } from "./store/memory.ts";
import { buildRenderers } from "./render/registry.ts";
import { addCandidate, displayKey, history, promote } from "./studio.ts";
import { keyPath } from "./key.ts";

const svc = () => {
  const origin = new InMemoryBlobStore();
  const cache = new InMemoryBlobStore();
  return { service: new AssetService(origin, cache, buildRenderers(), false), origin, cache };
};

const blob = (b: number) => ({ bytes: new Uint8Array([b]), contentType: "image/png", fingerprint: `fp${b}` });

test("upload → history → promote copies bytes to the stable display slot", async () => {
  const { service, origin } = svc();

  const k1 = await addCandidate(service, "clank", "front", "upload", blob(1), "png");
  await new Promise((r) => setTimeout(r, 2)); // distinct epoch versions
  const k3 = await addCandidate(service, "clank", "front", "openai", blob(3), "png");

  const hist = await history(service, "clank", "front");
  expect(hist.length).toBe(2);
  expect(hist[0].version >= hist[1].version).toBe(true); // newest first
  expect(hist[0].provider).toBe("openai");

  const dest = await promote(service, k3, "front");
  expect(keyPath(dest)).toBe(keyPath(displayKey("clank", "front", "png")));

  const chosen = await origin.get(displayKey("clank", "front", "png"));
  expect(chosen?.bytes[0]).toBe(3); // bytes of the promoted candidate

  // history untouched by promote
  expect((await history(service, "clank", "front")).length).toBe(2);
  void k1;
});

test("addCandidate is disk-only; save pushes to GCS; removes are tier-scoped", async () => {
  const { service, origin, cache } = svc();
  const k = await addCandidate(service, "root", "spine", "upload", blob(9), "png");
  // disk only until saved
  expect(await cache.head(k)).not.toBeNull();
  expect(await origin.head(k)).toBeNull();

  const hist = await history(service, "root", "spine");
  expect(hist[0].onDisk).toBe(true);
  expect(hist[0].onGcs).toBe(false);

  await service.save(k);
  expect(await origin.head(k)).not.toBeNull();

  await service.removeOrigin(k);
  expect(await origin.head(k)).toBeNull();
  expect(await cache.head(k)).not.toBeNull(); // local kept

  await service.removeCache(k);
  expect(await cache.head(k)).toBeNull();
});
