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

test("non-200 image fetch defers instead of failing the sync", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) =>
    String(input).includes("xmlapi2")
      ? new Response("<things><item><image>https://x/img.jpg</image></item></things>", { status: 200 })
      : new Response("nope", { status: 500 })) as unknown as typeof fetch;
  try {
    const s = new BggCoverSource();
    const [asset] = await s.discover({ id: "g1", name: "G", bggId: "999999" });
    await expect(asset.fetch()).rejects.toMatchObject({ name: "SourceUnavailableError" });
  } finally {
    globalThis.fetch = realFetch;
  }
});
