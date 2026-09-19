import { expect, test } from "bun:test";
import { GenBoxArtSource, buildGenSources, themeHint, facePrompt, openrouterImageGen } from "./box-art.ts";
import { aspectRatioFor, boxArtKey, STYLE_VERSION } from "../box-contract.ts";
import type { Entity } from "../types.ts";

const entity = (over: Partial<Entity> = {}): Entity => ({ id: "g1", name: "Test Quest", ...over });

test("aspectRatioFor snaps a face to the nearest supported ratio", () => {
  expect(aspectRatioFor("front", undefined)).toBe("1:1");
  expect(aspectRatioFor("front", { widthCm: 20, heightCm: 30 })).toBe("2:3");
  expect(aspectRatioFor("spine", undefined)).toBe("9:16");
  expect(aspectRatioFor("spine", { widthCm: 30, heightCm: 30, depthCm: 6 })).toBe("9:16"); // 6:30 = 0.2 → nearest 9:16
});

test("themeHint uses facts, falls back when none", () => {
  expect(themeHint(entity())).toContain("abstract strategy");
  expect(themeHint(entity({ categories: ["Space"], mechanics: ["Dice"] }))).toBe("Space, Dice");
});

test("palette flows into the style clause; falls back to default", () => {
  expect(facePrompt("front", "Nova", { theme: "x", palette: ["#111111", "#222222"] })).toContain("#111111, #222222");
  expect(facePrompt("front", "Nova", { theme: "x" })).toContain("#f2e9d0");
});

test("description replaces the theme line", () => {
  const p = facePrompt("front", "Nova", { theme: "space", description: "rival galaxies at war" });
  expect(p).toContain("rival galaxies at war");
  expect(p).not.toContain("Evoke its theme");
});

test("boxArtKey addresses the gen source per face", () => {
  expect(boxArtKey("g1", "front")).toEqual({ entity: "g1", kind: "front", source: "gen", variant: STYLE_VERSION, ext: "png" });
  expect(boxArtKey("g1", "spine").kind).toBe("spine");
});

test("source is inert without an ImageGen, and discovers one asset with one", async () => {
  expect(await new GenBoxArtSource("front").discover(entity())).toEqual([]);
  expect(buildGenSources({})).toEqual([]);

  const calls: Array<[string, string]> = [];
  const gen = async (prompt: string, ar: string) => { calls.push([prompt, ar]); return new Uint8Array([1]); };
  const src = new GenBoxArtSource("front", { gen });
  const [asset] = await src.discover(entity({ categories: ["Space"], dims: { widthCm: 20, heightCm: 30 } }));
  expect(asset.key).toEqual(boxArtKey("g1", "front"));
  expect(asset.fingerprint).toContain(STYLE_VERSION);
  const blob = await asset.fetch();
  expect(blob.contentType).toBe("image/png");
  expect(calls[0][1]).toBe("2:3"); // aspect ratio from dims
});

test("buildGenSources yields both faces when configured", () => {
  const sources = buildGenSources({ gen: async () => new Uint8Array() });
  expect(sources.map((s) => s.kind)).toEqual(["front", "spine"]);
});

test("buildGenSources yields both faces from an apiKey alone", () => {
  expect(buildGenSources({ apiKey: "k" }).map((s) => s.kind)).toEqual(["front", "spine"]);
});

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

test("openrouterImageGen posts the Image API shape and decodes the b64 png", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  await withFetch(async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ data: [{ b64_json: "AAAA", media_type: "image/png" }] }), { status: 200 });
  }, async () => {
    const bytes = await openrouterImageGen("or-key", "google/gemini-2.5-flash-image")("a cozy front", "2:3");
    expect(bytes).toEqual(new Uint8Array([0, 0, 0])); // "AAAA" → 00 00 00
  });
  expect(calls.length).toBe(1);
  expect(calls[0].url).toBe("https://openrouter.ai/api/v1/images");
  expect(new Headers(calls[0].init.headers).get("Authorization")).toBe("Bearer or-key");
  expect(JSON.parse(String(calls[0].init.body))).toEqual({
    model: "google/gemini-2.5-flash-image",
    prompt: "a cozy front",
    aspect_ratio: "2:3",
    output_format: "png",
  });
});

test("openrouterImageGen maps 429 to SourceUnavailableError", async () => {
  await withFetch(async () => new Response("rate limited", { status: 429 }), async () => {
    await expect(openrouterImageGen("k", "m")("p", "1:1")).rejects.toThrow("openrouter image rate-limited (429)");
  });
});

test("openrouterImageGen surfaces the API error message with the status", async () => {
  await withFetch(
    async () => new Response(JSON.stringify({ error: { message: "Insufficient credits" } }), { status: 402 }),
    async () => {
      await expect(openrouterImageGen("k", "m")("p", "1:1")).rejects.toThrow("openrouter image 402: Insufficient credits");
    },
  );
});
