import { expect, test, describe } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssetKey } from "../key.ts";
import type { BlobStore } from "../types.ts";
import { InMemoryBlobStore } from "./memory.ts";
import { DiskBlobStore } from "./disk.ts";

const key = (over: Partial<AssetKey> = {}): AssetKey => ({
  entity: "game1",
  kind: "cover",
  source: "bgg",
  variant: "original",
  ext: "jpg",
  ...over,
});

/** One contract, run against every BlobStore backend. */
function contract(name: string, make: () => Promise<BlobStore>) {
  describe(name, () => {
    test("put -> head -> get round-trip with fingerprint", async () => {
      const s = await make();
      const k = key();
      expect(await s.head(k)).toBeNull();
      expect(await s.get(k)).toBeNull();
      await s.put(k, { bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg", fingerprint: "fp-1" });
      const rec = await s.head(k);
      expect(rec?.fingerprint).toBe("fp-1");
      expect(rec?.contentType).toBe("image/jpeg");
      expect((await s.get(k))?.bytes).toEqual(new Uint8Array([1, 2, 3]));
    });

    test("list returns keys under a prefix", async () => {
      const s = await make();
      await s.put(key({ source: "bgg" }), { bytes: new Uint8Array([1]), contentType: "image/jpeg" });
      await s.put(key({ source: "ludopedia" }), { bytes: new Uint8Array([2]), contentType: "image/jpeg" });
      await s.put(key({ kind: "rulebook", source: "hermes", variant: "base", ext: "pdf" }), { bytes: new Uint8Array([3]), contentType: "application/pdf" });
      const covers = await s.list({ entity: "game1", kind: "cover" });
      expect(covers.map((k) => k.source).sort()).toEqual(["bgg", "ludopedia"]);
      const all = await s.list({ entity: "game1" });
      expect(all.length).toBe(3);
    });
  });
}

contract("InMemoryBlobStore", async () => new InMemoryBlobStore());
contract("DiskBlobStore", async () => new DiskBlobStore(await mkdtemp(join(tmpdir(), "blob-"))));
