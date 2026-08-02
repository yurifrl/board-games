import { expect, test } from "bun:test";
import { GenBoxArtSource, buildGenSources, themeHint, facePrompt, HOUSE_STYLE } from "./box-art.ts";
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

test("prompts carry title + shared style; spine is a standalone strip on white", () => {
  const p = facePrompt("front", "Nova", { theme: "space" });
  expect(p).toContain("Nova");
  expect(p).toContain(HOUSE_STYLE);
  const spine = facePrompt("spine", "Nova", { theme: "space" });
  expect(spine).toContain("STRIP");
  expect(spine.toLowerCase()).toContain("white");
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
