import { expect, test } from "bun:test";
import { studioPage, renderFacePane } from "./views.tsx";
import type { Game } from "../games.ts";
import type { ImageModel } from "./models.ts";

const game: Game = { id: "g1", name: "Test Quest", tags: [], isGame: true, purchasedAt: null, forSale: false };

const models: ImageModel[] = [
  { id: "google/gemini-2.5-flash-image", name: "Gemini 2.5 Flash Image", inputImage: true },
  { id: "qwen/qwen-image", name: "Qwen Image", inputImage: false },
];

const opts = { gcs: false, gen: true, models, defaultModel: "qwen/qwen-image", obsidian: false };

test("Generate form embeds the server default model; models list lives in the global selector", () => {
  const pane = renderFacePane(game, "front", [], opts);
  expect(pane).not.toContain("<select"); // per-face model select is gone — global selector only
  expect(pane).toContain('<input type="hidden" name="model" value="qwen/qwen-image"');
  const page = studioPage([game], opts, { game, front: [], spine: [] });
  expect(page).toContain('<select id="globalModel"');
  expect(page).toContain('value="google/gemini-2.5-flash-image"');
  expect(page).toContain('value="qwen/qwen-image" selected=""'); // default preselected
});

test("with one or zero models the Generate form embeds the server default model", () => {
  // genOpts default: env("OPENROUTER_IMAGE_MODEL") || models[0]?.id || ""
  const one = renderFacePane(game, "front", [], { ...opts, models: [models[0]], defaultModel: models[0].id });
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
  // The inline script mentions 'Generate' in cancel-restore strings even when
  // the UI never renders one — assert the markup, not the JS source.
  const markup = html.replace(/<script>[\s\S]*?<\/script>/g, "").replace(/<style>[\s\S]*?<\/style>/g, "");
  expect(markup).not.toContain("Generate");
  expect(markup).not.toContain('id="bulkGo"');
  expect(markup).not.toContain('id="selBtn"');
  expect(markup).not.toContain('id="exBtn"');
});

test("home renders the Examples mode toggle and counter", () => {
  const html = studioPage([game], opts);
  expect(html).toContain('<button id="exBtn" class="gstyle"');
  expect(html).toContain('id="exCount"');
  expect(html).toContain("example");
});

test("bulk progress surfaces failures instead of swallowing them", () => {
  const html = studioPage([game], opts);
  // Non-JSON bodies (503 "openrouter not configured", proxy HTML) must surface
  // the status + server text, not die as a cryptic SyntaxError.
  expect(html).toContain("function readJson(r)");
  expect(html).toContain("'HTTP '+r.status");
  // The progress poller must catch poll failures (e.g. 404 "no job" after an
  // admin restart) — previously an unhandled rejection froze "starting…" and
  // left the buttons disabled forever.
  expect(html).toContain("},function(e){ // poll failed (admin restarted mid-job, proxy error, network blip)");
});
