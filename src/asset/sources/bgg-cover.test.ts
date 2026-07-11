import { expect, test } from "bun:test";
import { BggCoverSource } from "./bgg-cover.ts";

test("no bggId -> nothing to fetch", async () => {
  const s = new BggCoverSource();
  expect(await s.discover({ id: "g1", name: "G" })).toEqual([]);
});

test("fingerprints by id (not image/grid), keyed as the cover original", async () => {
  const s = new BggCoverSource();
  const [asset] = await s.discover({ id: "g1", name: "G", bggId: "178900" });
  expect(asset.fingerprint).toBe("bgg:178900");
  expect(asset.key).toEqual({ entity: "g1", kind: "cover", source: "bgg", variant: "original", ext: "jpg" });
});
