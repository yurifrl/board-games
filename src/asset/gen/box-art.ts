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

/** BASE_STYLE (or a caller-supplied base) plus the palette clause. */
export function styleWithPalette(palette?: string[], base: string = BASE_STYLE): string {
  const p = (palette?.length ? palette : DEFAULT_PALETTE).join(", ");
  return `${base} Use a cohesive limited palette derived from these colors: ${p}.`;
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
  /** House-style base to use instead of BASE_STYLE (e.g. from Obsidian). */
  style?: string;
}

export function facePrompt(face: Face, name: string, input: FaceInput): string {
  const style = styleWithPalette(input.palette, input.style);
  const parts = [input.description, input.artNote].map((s) => s?.trim()).filter(Boolean);
  const subject = parts.length ? `What it's about: ${parts.join(" ")}` : `Evoke its theme: ${input.theme}.`;
  if (face === "spine") {
    const palette = (input.palette?.length ? input.palette : DEFAULT_PALETTE).join(", ");
    const upper = name.toUpperCase();
    const words = upper.split(/\s+/).filter(Boolean);
    let lines: string[];
    if (words.length <= 1) {
      lines = [upper];
    } else {
      const total = upper.length;
      let best = 1, bestDiff = Infinity;
      for (let i = 1; i < words.length; i++) {
        const left = words.slice(0, i).join(" ").length;
        const diff = Math.abs(left - (total - left));
        if (diff < bestDiff) { bestDiff = diff; best = i; }
      }
      lines = [words.slice(0, best).join(" "), words.slice(best).join(" ")];
    }
    const linesText = lines.map((l, i) => {
      const sp = l.split(/\s+/).map((w) => w.split("").join("-")).join(" ");
      return `Line ${i + 1}: "${l}"  (letters: ${sp})`;
    }).join("\n");
    return (
      `Generate a flat front view of a single book spine (not 3D). Render the ` +
      `title like a REAL BOOK SPINE: the lettering runs along the tall vertical ` +
      `axis, ROTATED 90 degrees so the words read from bottom to top. Write each ` +
      `word NORMALLY as a horizontal word (correctly spelled) and rotate it as a ` +
      `whole — do NOT stack separate upright letters. Set the title on ` +
      `${lines.length} line${lines.length > 1 ? "s" : ""}, as parallel lines of ` +
      `rotated text running up the spine right next to each other:\n\n` +
      `${linesText}\n\nSpell every word exactly and correctly (the full title is ` +
      `"${upper}"). Every line must show all of its words FULLY spelled from end ` +
      `to end — include the FIRST and LAST letter of every word, which are the ` +
      `most commonly dropped — with no letter running off the top, bottom or ` +
      `sides. Make the text ` +
      `bold, high-contrast and centred, and PREFER shrinking it over cutting ` +
      `anything off: size the letters small enough that the WIDEST word fits ` +
      `within the spine width with a clear margin on both sides, and the whole ` +
      `title fits top to bottom. Each word runs VERTICALLY up the spine (rotated ` +
      `90 degrees, reading bottom to top) so its LENGTH uses the tall axis — ` +
      `never write a word so wide across the spine that its first or last letter ` +
      `is cut off at the side. For multiple words, set them as parallel vertical ` +
      `lines side by side. ` +
      `Behind it, a richly textured illustrated background scene ` +
      `evoking the game fills the whole image edge to edge — NO frame, NO border, ` +
      `NO panel, NO cartouche, NO boxes or delimited boundaries of any kind. ` +
      `Layer 2-3 foreground elements (a branch, an object or motif) that cross ` +
      `OVER the letters, clearly in FRONT of the title, for depth. ${subject} Do ` +
      `NOT depict any people, human figures, silhouettes, crowds, hands or faces. ` +
      `Flat graphic design only — no perspective, no mockup, no 3D render. Use a ` +
      `cohesive limited palette derived from these colors: ${palette}.`
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

const GEMINI_MODEL = "gemini-2.5-flash-image";

/** Map a face's aspect ratio to the nearest ratio the Gemini image API accepts. */
function geminiAspect(aspectRatio: string): string {
  const [w, h] = aspectRatio.split(":").map(Number);
  const r = w / h;
  if (r <= 0.6) return "9:16"; // spine / very tall
  if (r <= 0.85) return "3:4"; // portrait cover
  if (r < 1.2) return "1:1";
  if (r < 1.6) return "4:3";
  return "16:9";
}

/** {@link ImageGen} backed by the Gemini image API (GEMINI_API_KEY). */
export function geminiImageGen(apiKey: string, model = GEMINI_MODEL): ImageGen {
  return async (prompt, aspectRatio) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { imageConfig: { aspectRatio: geminiAspect(aspectRatio) } },
      }),
    });
    if (res.status === 429) throw new SourceUnavailableError(BOX_ART_SOURCE, "gemini image rate-limited (429)");
    if (!res.ok) throw new Error(`gemini image ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
    };
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const b64 = parts.find((p) => p.inlineData?.data)?.inlineData?.data;
    if (!b64) throw new Error(`gemini returned no image for prompt: ${prompt.slice(0, 60)}…`);
    return Uint8Array.from(Buffer.from(b64, "base64"));
  };
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
