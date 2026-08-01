import { expect, test } from "bun:test";
import { snapRatio, themeHint, coverPrompt, spinePrompt, generateBoxArt, HOUSE_STYLE } from "./box-art.ts";
import type { Game } from "../../games.ts";

const game = (over: Partial<Game> = {}): Game => ({
  id: "g1", name: "Test Quest", tags: [], isGame: true, purchasedAt: null, forSale: false, ...over,
});

test("snapRatio snaps a box face to the nearest supported ratio", () => {
  expect(snapRatio(undefined, undefined)).toBe("1:1");
  expect(snapRatio(30, 30)).toBe("1:1");
  expect(snapRatio(20, 30)).toBe("2:3"); // 0.667
  expect(snapRatio(30, 20)).toBe("3:2"); // 1.5
});

test("themeHint uses facts, falls back when none", () => {
  expect(themeHint(game())).toContain("abstract strategy");
  expect(themeHint(game({ facts: { categories: ["Space"], mechanics: ["Dice"] } as any }))).toBe("Space, Dice");
});

test("prompts carry the game title and the shared house style", () => {
  const g = game({ name: "Nova" });
  for (const p of [coverPrompt(g), spinePrompt(g)]) {
    expect(p).toContain("Nova");
    expect(p).toContain(HOUSE_STYLE);
  }
  expect(spinePrompt(g)).toContain("SPINE");
});

test("generateBoxArt writes cover + spine and passes the right aspect ratios", async () => {
  const calls: string[] = [];
  const gen = async (_p: string, ar: string) => { calls.push(ar); return new Uint8Array([1]); };
  const dir = `${process.env.TMPDIR ?? "/tmp"}/box-art-test-${Date.now()}`;
  const out = await generateBoxArt(game({ siteSize: { widthCm: 20, heightCm: 30 } }), dir, gen);
  expect(out.cover.endsWith("g1_cover.png")).toBe(true);
  expect(out.spine.endsWith("g1_spine.png")).toBe(true);
  expect(calls).toEqual(["2:3", "9:16"]); // cover snapped from size, spine fixed
});
