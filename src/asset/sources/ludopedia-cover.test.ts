import { expect, test } from "bun:test";
import { LudopediaCoverSource } from "./ludopedia-cover.ts";

test("no ludopediaId -> nothing to fetch", async () => {
  const s = new LudopediaCoverSource();
  expect(await s.discover({ id: "g1", name: "G" })).toEqual([]);
});

test("non-200 capa fetch defers instead of failing the sync (bucket 403s absent ids)", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: string | URL | Request) => new Response("AccessDenied", { status: 403 })) as unknown as typeof fetch;
  try {
    const s = new LudopediaCoverSource();
    const [asset] = await s.discover({ id: "g1", name: "G", ludopediaId: "383457" });
    await expect(asset.fetch()).rejects.toMatchObject({ name: "SourceUnavailableError" });
  } finally {
    globalThis.fetch = realFetch;
  }
});
