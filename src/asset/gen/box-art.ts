/**
 * Generated box-art source. Turns a game into cohesive flat-vector box faces
 * (front + spine) via an image model, plugged into the same pull-pipeline as
 * the BGG/Ludopedia cover sources — so the store (GCS origin + disk cache) and
 * the `/asset` serving path handle it with zero special-casing.
 *
 * The single {@link HOUSE_STYLE} string is the prompt harness: every face of
 * every game is generated against it, which is what makes the whole shelf read
 * as one publisher's line. Fingerprinted by (style version + name + theme), so
 * art is generated once and only re-generated when the prompt or style changes.
 */
import {
  BOX_ART_FORMAT, BOX_ART_SOURCE, FACES, STYLE_VERSION,
  aspectRatioFor, boxArtKey, type BoxDims, type Face,
} from "../box-contract.ts";
import { SourceUnavailableError, type AssetBlob, type AssetSource, type DiscoveredAsset, type Entity } from "../types.ts";

/** Style contract minus the palette (the palette is per-game, see {@link styleWithPalette}). */
export const BASE_STYLE =
  "Flat 2D vector illustration drawn perfectly straight-on, filling the whole " +
  "canvas edge to edge. This is the printed cover ARTWORK itself, NOT a " +
  "photograph of a box: no 3D box, no product mockup, no perspective, no box " +
  "sides or thickness, no packaging, no shelf, no surrounding background, no " +
  "drop shadow. Bold geometric shapes, thick clean outlines" +
  "no photorealism, no heavy gradients." +
  "Prefer scenery, architecture, objects and atmosphere; avoid depicting people " +
  "or human figures, for a warm cozy mood. ";

/** Fallback palette when a game has no cover to sample. */
export const DEFAULT_PALETTE = ["#f2e9d0", "#3fa39a", "#e0a83e", "#e5654e", "#1f2a44"];

/** BASE_STYLE plus the palette clause — every face of a game shares its palette. */
export function styleWithPalette(palette?: string[]): string {
  const p = (palette?.length ? palette : DEFAULT_PALETTE).join(", ");
  return `${BASE_STYLE} Use a cohesive limited palette derived from these colors: ${p}.`;
}

/** Back-compat default style (default palette). */
export const HOUSE_STYLE = styleWithPalette();

/** Motif words drawn from the entity's own facts — the per-game half of the prompt. */
export function themeHint(e: Entity): string {
  const bits = [...(e.categories ?? []).slice(0, 3), ...(e.mechanics ?? []).slice(0, 3)];
  return bits.length ? bits.join(", ") : "abstract strategy board game";
}

export interface FaceInput {
  theme: string;
  description?: string;
  artNote?: string;
  palette?: string[];
}

/** Wrap a title into vertical columns: one per word, or a long single word split
 * into balanced chunks. Columns are rendered side by side on the spine. */
export function spineColumns(name: string, max = 7): string[] {
  const words = name.toUpperCase().split(/\s+/).filter(Boolean);
  if (words.length > 1) return words;
  const w = words[0] ?? "";
  if (w.length <= max) return [w];
  const n = Math.ceil(w.length / max);
  const size = Math.ceil(w.length / n);
  const cols: string[] = [];
  for (let i = 0; i < w.length; i += size) cols.push(w.slice(i, i + size));
  return cols;
}

export function facePrompt(face: Face, name: string, input: FaceInput): string {
  const style = styleWithPalette(input.palette);
  const parts = [input.description, input.artNote].map((s) => s?.trim()).filter(Boolean);
  const subject = parts.length ? `What it's about: ${parts.join(" ")}` : `Evoke its theme: ${input.theme}.`;
  if (face === "spine") {
    const palette = (input.palette?.length ? input.palette : DEFAULT_PALETTE).join(", ");
    const cols = spineColumns(name);
    const rows = Math.max(...cols.map((c) => c.length));
    const grid = Array.from({ length: rows }, (_, r) => cols.map((c) => c[r] ?? " ").join("  ")).join("\n");
    const layout = cols.length > 1
      ? `Arrange the title as ${cols.length} vertical columns placed SIDE BY SIDE ` +
        `(left to right), all starting at the TOP and running downward in parallel ` +
        `right next to each other. NEVER stack one column below another. `
      : `Arrange the title as a single vertical column down the centre. `;
    return (
      `Generate a flat front view of a single book spine (not 3D), the title ` +
      `centred.\n\n${layout}Within each column write ONE letter per line, each ` +
      `letter UPRIGHT and stacked top to bottom. Do NOT rotate the letters. Do NOT ` +
      `write any word horizontally or on its side. Reproduce EXACTLY this letter ` +
      `grid — columns are side by side, one letter per row per column — with no ` +
      `extra, missing, doubled or reordered letters:\n\n${grid}\n\nSize the letters ` +
      `to fit with clear margins so nothing runs off any edge; keep them bold, ` +
      `high-contrast and centred. Behind them, a richly textured illustrated ` +
      `background scene evoking the game fills the whole image edge to edge — NO ` +
      `frame, NO border, NO panel, NO cartouche, NO boxes or delimited boundaries ` +
      `of any kind. Layer 2-3 foreground elements (a branch, an object or motif) ` +
      `that cross OVER the letters, clearly in FRONT of the title, for depth. ` +
      `${subject} Do NOT depict any people, human figures, silhouettes, crowds, ` +
      `hands or faces. Flat graphic design only — no perspective, no mockup, no 3D ` +
      `render. Use a cohesive limited palette derived from these colors: ${palette}.`
    );
  }
  return (
    `Flat 2D front-cover ARTWORK for the board game titled "${name}" — the ` +
    `printed graphic drawn straight-on, filling the ENTIRE frame edge to edge. ` +
    `NOT a 3D box, NOT a product render, NO perspective, NO box sides, NO shadow. ` +
    `${subject} Iconic central illustration, title clearly legible. ${style}`
  );
}

/** prompt (+ aspect ratio) → PNG bytes. The only seam onto an actual model. */
export type ImageGen = (prompt: string, aspectRatio: string) => Promise<Uint8Array>;

const OPENAI_MODEL = "gpt-image-1";

/** gpt-image-1 supports a fixed set of sizes; map a face's aspect ratio to the nearest. */
function openaiSize(aspectRatio: string): string {
  const [w, h] = aspectRatio.split(":").map(Number);
  const r = w / h;
  if (r <= 0.8) return "1024x1536"; // portrait (spine, tall covers)
  if (r >= 1.25) return "1536x1024"; // landscape
  return "1024x1024"; // square
}

/** Default {@link ImageGen} backed by OpenAI's gpt-image-1. */
export function openaiImageGen(apiKey: string, model = OPENAI_MODEL): ImageGen {
  return async (prompt, aspectRatio) => {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, prompt, size: openaiSize(aspectRatio), n: 1 }),
    });
    if (res.status === 429) throw new SourceUnavailableError(BOX_ART_SOURCE, "openai image rate-limited (429)");
    if (!res.ok) throw new Error(`openai image ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) throw new Error(`openai returned no image for prompt: ${prompt.slice(0, 60)}…`);
    return Uint8Array.from(Buffer.from(b64, "base64"));
  };
}

export interface GenConfig {
  /** OPENAI_API_KEY. When absent the source is inert (discovers nothing). */
  apiKey?: string;
  /** Test seam — defaults to {@link openaiImageGen}. */
  gen?: ImageGen;
}

/**
 * One {@link AssetSource} per face. Registered in sources/registry.ts alongside
 * the cover sources; the pipeline fingerprints, skips unchanged, and stores.
 */
export class GenBoxArtSource implements AssetSource {
  readonly id = BOX_ART_SOURCE;
  readonly priority = 10;
  private readonly gen?: ImageGen;

  constructor(readonly kind: Face, cfg: GenConfig = {}) {
    this.gen = cfg.gen ?? (cfg.apiKey ? openaiImageGen(cfg.apiKey) : undefined);
  }

  async discover(e: Entity): Promise<DiscoveredAsset[]> {
    if (!this.gen) return [];
    const theme = themeHint(e);
    const key = boxArtKey(e.id, this.kind);
    const prompt = facePrompt(this.kind, e.name, { theme, description: e.description, artNote: e.artNote, palette: e.palette });
    const ratio = aspectRatioFor(this.kind, e.dims);
    return [
      {
        key,
        fingerprint: `gen:${STYLE_VERSION}:${this.kind}:${e.name}|${theme}|${e.description ?? ""}|${e.artNote ?? ""}|${(e.palette ?? []).join(",")}`,
        fetch: async () => {
          const bytes = await this.gen!(prompt, ratio);
          return { bytes, contentType: `image/${BOX_ART_FORMAT}` };
        },
      },
    ];
  }
}

/** Both face sources, or none when no API key is configured. */
export function buildGenSources(cfg: GenConfig = {}): AssetSource[] {
  if (!cfg.apiKey && !cfg.gen) return [];
  return FACES.map((face) => new GenBoxArtSource(face, cfg));
}
