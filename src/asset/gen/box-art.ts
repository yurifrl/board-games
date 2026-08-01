/**
 * Box-art generator — an isolated component that turns a game id into two
 * cohesive, flat-vector images: the box FRONT (the "cover", seen when the box
 * is open/facing you) and the box SPINE (the thin edge seen on the shelf).
 *
 * It is deliberately self-contained: pass a game and an {@link ImageGen}, get
 * back file paths in a tmp dir. The worker will later call {@link generateBoxArt}
 * and a separate step will upload the tmp files to the bucket — this module does
 * neither, so it has no dependency on the store, GCS, or the pipeline.
 *
 *   bun run src/asset/gen/box-art.ts <id> [<id> ...]      # from the catalog
 *   GEN_DIR=/somewhere bun run src/asset/gen/box-art.ts <id>
 *
 * The single {@link HOUSE_STYLE} string is the "prompt harness": every image
 * for every game is generated against it, which is what keeps the whole shelf
 * looking like one publisher's line.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Game } from "../../games.ts";
import { loadCatalog } from "../../store.ts";

/** The shared visual contract. Change this once → the whole shelf restyles. */
export const HOUSE_STYLE =
  "Flat vector illustration, bold geometric shapes, thick clean outlines, " +
  "subtle paper grain, limited cohesive palette (cream #f2e9d0, teal #3fa39a, " +
  "mustard #e0a83e, coral #e5654e, deep navy #1f2a44). No photorealism, no " +
  "heavy gradients, no drop shadows. Centered strong sans-serif title. " +
  "Consistent board-game publisher house style across the whole line.";

/** Gemini's supported aspect ratios; we snap a box face to the nearest one. */
const RATIOS: Array<[string, number]> = [
  ["1:1", 1], ["4:5", 0.8], ["5:4", 1.25], ["3:4", 0.75], ["4:3", 1.333],
  ["2:3", 0.667], ["3:2", 1.5], ["9:16", 0.5625], ["16:9", 1.778], ["21:9", 2.333],
];

/** Nearest supported aspect ratio for a physical box face (w×h in cm). */
export function snapRatio(widthCm?: number, heightCm?: number, fallback = "1:1"): string {
  if (!widthCm || !heightCm) return fallback;
  const target = widthCm / heightCm;
  return RATIOS.reduce((best, r) =>
    Math.abs(r[1] - target) < Math.abs(best[1] - target) ? r : best,
  )[0];
}

/** Motif words drawn from the game's own facts — the per-game half of the prompt. */
export function themeHint(g: Game): string {
  const f = g.facts;
  const cats = f?.categories?.slice(0, 3) ?? [];
  const mechs = f?.mechanics?.slice(0, 3) ?? [];
  const bits = [...cats, ...mechs];
  return bits.length ? bits.join(", ") : "abstract strategy board game";
}

export function coverPrompt(g: Game): string {
  return (
    `Board game box FRONT COVER for the game titled "${g.name}". ` +
    `Evoke its theme: ${themeHint(g)}. Iconic central illustration with the ` +
    `title clearly legible. ${HOUSE_STYLE}`
  );
}

export function spinePrompt(g: Game): string {
  return (
    `Board game box SPINE only — a tall narrow vertical strip, the thin edge ` +
    `seen on a shelf — for the game titled "${g.name}". Vertical title text ` +
    `"${g.name}" reading bottom-to-top, a small emblem icon matching the cover, ` +
    `theme hint: ${themeHint(g)}. ${HOUSE_STYLE}`
  );
}

/** prompt (+ aspect ratio) → PNG bytes. The only seam onto an actual model. */
export type ImageGen = (prompt: string, aspectRatio: string) => Promise<Uint8Array>;

const GEMINI_MODEL = "gemini-2.5-flash-image";

/** Default {@link ImageGen} backed by Gemini's image model. */
export function geminiImageGen(apiKey: string, model = GEMINI_MODEL): ImageGen {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  return async (prompt, aspectRatio) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { imageConfig: { aspectRatio } },
      }),
    });
    if (!res.ok) throw new Error(`gemini image ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const inline = parts.find((p: any) => p.inlineData)?.inlineData?.data;
    if (!inline) throw new Error(`gemini returned no image for prompt: ${prompt.slice(0, 60)}…`);
    return Uint8Array.from(Buffer.from(inline, "base64"));
  };
}

export interface BoxArt {
  cover: string;
  spine: string;
}

/**
 * Generate the cover + spine for one game into {@link outDir} as
 * `<id>_cover.png` and `<id>_spine.png`. Returns the two paths.
 */
export async function generateBoxArt(g: Game, outDir: string, gen: ImageGen): Promise<BoxArt> {
  await mkdir(outDir, { recursive: true });
  const coverRatio = snapRatio(g.siteSize?.widthCm, g.siteSize?.heightCm, "1:1");
  const cover = join(outDir, `${g.id}_cover.png`);
  const spine = join(outDir, `${g.id}_spine.png`);
  await writeFile(cover, await gen(coverPrompt(g), coverRatio));
  await writeFile(spine, await gen(spinePrompt(g), "9:16"));
  return { cover, spine };
}

// ── CLI ────────────────────────────────────────────────────────────────────
if (import.meta.main) {
  const ids = process.argv.slice(2);
  if (!ids.length) {
    console.error("usage: bun run src/asset/gen/box-art.ts <id> [<id> ...]");
    process.exit(1);
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is required");
    process.exit(1);
  }
  const dataDir = process.env.DATA_DIR ?? "./data";
  const outDir = process.env.GEN_DIR ?? "./data/tmp/box-art";
  const games = await loadCatalog(dataDir);
  const byId = new Map(games.map((g) => [g.id, g]));
  const gen = geminiImageGen(apiKey);
  for (const id of ids) {
    const g = byId.get(id);
    if (!g) {
      console.error(`  skip ${id}: not in catalog`);
      continue;
    }
    const { cover, spine } = await generateBoxArt(g, outDir, gen);
    console.log(`  ${g.name}\n    cover ${cover}\n    spine ${spine}`);
  }
}
