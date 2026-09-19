import { expect, test, setSystemTime } from "bun:test";
import { openRouterImageModels, resetModelsCache } from "./models.ts";

type RawModel = { id: string; name?: string; architecture?: { output_modalities?: string[] } };

const catalog = (models: RawModel[], status = 200): Response =>
  new Response(JSON.stringify({ data: models }), { status });

/** Swap global fetch for the duration of `run` (tests must never hit the network). */
async function withFetch(impl: typeof fetch, run: () => Promise<void>): Promise<void> {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    await run();
  } finally {
    globalThis.fetch = orig;
  }
}

const IMAGE_MODEL: RawModel = {
  id: "google/gemini-2.5-flash-image",
  name: "Gemini 2.5 Flash Image",
  architecture: { output_modalities: ["image"] },
};

test("keeps only models whose architecture declares image output", async () => {
  resetModelsCache();
  await withFetch(async () => catalog([
    { id: "openai/gpt-4o", name: "GPT-4o", architecture: { output_modalities: ["text"] } },
    IMAGE_MODEL,
    { id: "google/gemini-2.5-flash-image-preview", architecture: { output_modalities: ["text", "image"] } },
    { id: "no-architecture" },
    { id: "qwen/qwen-image", name: "Qwen Image", architecture: { output_modalities: ["image"] } },
  ]), async () => {
    expect(await openRouterImageModels()).toEqual([
      { id: "google/gemini-2.5-flash-image", name: "Gemini 2.5 Flash Image" },
      { id: "google/gemini-2.5-flash-image-preview", name: "google/gemini-2.5-flash-image-preview" },
      { id: "qwen/qwen-image", name: "Qwen Image" },
    ]);
  });
});

test("hits the image-filtered public endpoint without an Authorization header", async () => {
  resetModelsCache();
  let url = "";
  let auth: string | null | undefined;
  await withFetch(async (u, init) => {
    url = String(u);
    auth = new Headers(init?.headers).get("Authorization");
    return catalog([IMAGE_MODEL]);
  }, async () => {
    await openRouterImageModels();
  });
  expect(url).toBe("https://openrouter.ai/api/v1/models?output_modalities=image");
  expect(auth ?? null).toBe(null);
});

test("caches the catalog within the TTL and refetches after it lapses", async () => {
  resetModelsCache();
  let fetches = 0;
  setSystemTime(1_000_000);
  await withFetch(async () => {
    fetches++;
    return catalog([{ id: `m${fetches}`, name: `M${fetches}`, architecture: { output_modalities: ["image"] } }]);
  }, async () => {
    const first = await openRouterImageModels();
    expect(first).toEqual([{ id: "m1", name: "M1" }]);
    setSystemTime(1_000_000 + 9 * 60_000); // still inside the TTL
    expect(await openRouterImageModels()).toEqual(first);
    expect(fetches).toBe(1);
    setSystemTime(1_000_000 + 11 * 60_000); // TTL lapsed → refetch
    expect(await openRouterImageModels()).toEqual([{ id: "m2", name: "M2" }]);
    expect(fetches).toBe(2);
  });
  setSystemTime(); // restore the real clock
});

test("a failed fetch is not cached and degrades to the last good list", async () => {
  resetModelsCache();
  let fetches = 0;
  await withFetch(async () => {
    fetches++;
    return fetches === 1
      ? catalog([{ id: "good", name: "Good", architecture: { output_modalities: ["image"] } }])
      : new Response("boom", { status: 500 });
  }, async () => {
    expect(await openRouterImageModels()).toEqual([{ id: "good", name: "Good" }]);
    setSystemTime(Date.now() + 11 * 60_000); // expire the good entry
    expect(await openRouterImageModels()).toEqual([{ id: "good", name: "Good" }]); // last good list
    expect(fetches).toBe(2);
    setSystemTime(Date.now() + 22 * 60_000); // the failure was not cached → retry
    expect(await openRouterImageModels()).toEqual([{ id: "good", name: "Good" }]);
    expect(fetches).toBe(3);
  });
  setSystemTime(); // restore the real clock
});
