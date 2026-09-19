import { expect, test } from "bun:test";
import { studioPage, renderFacePane } from "./views.tsx";
import type { Game } from "../games.ts";
import type { ImageModel } from "./models.ts";

const game: Game = { id: "g1", name: "Test Quest", tags: [], isGame: true, purchasedAt: null, forSale: false };

const models: ImageModel[] = [
  { id: "google/gemini-2.5-flash-image", name: "Gemini 2.5 Flash Image" },
  { id: "qwen/qwen-image", name: "Qwen Image" },
];

const opts = { gcs: false, gen: true, models, defaultModel: "qwen/qwen-image", obsidian: false };

test("Generate pane renders only the listed OpenRouter models, default preselected", () => {
  const html = renderFacePane(game, "front", [], opts);
  expect(html).toContain('<select name="model"');
  expect(html).toContain('value="google/gemini-2.5-flash-image"');
  expect(html).toContain('value="qwen/qwen-image" selected=""');
  expect(html).not.toMatch(/<select name="provider"/); // openai/google choice is gone
});

test("with one or zero models the Generate form embeds the default model instead", () => {
  const one = renderFacePane(game, "front", [], { ...opts, models: [models[0]] });
  expect(one).not.toContain("<select");
  expect(one).toContain('name="model" value="google/gemini-2.5-flash-image"');
  const none = renderFacePane(game, "front", [], { ...opts, models: [] });
  expect(none).toContain('name="model" value="qwen/qwen-image"');
});

test("detail page opens on the spine face with the Spine tab active", () => {
  const html = studioPage([game], opts, { game, front: [], spine: [] });
  expect(html).toContain('data-face="spine"');
  expect(html).toContain('data-f="spine" class="on"');
  expect(html).not.toContain('data-f="front" class="on"');
});

test("gen=false hides every generation surface", () => {
  const html = studioPage([game], { gcs: false, gen: false, models: [], defaultModel: "", obsidian: false });
  expect(html).not.toContain("Generate");
  expect(html).not.toContain('id="bulkGo"');
  expect(html).not.toContain('id="selBtn"');
});
