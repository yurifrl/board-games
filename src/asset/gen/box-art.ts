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
import { trimBackground } from "../tint.ts";
import { SourceUnavailableError, type AssetBlob, type AssetSource, type DiscoveredAsset, type Entity } from "../types.ts";

/** Style contract minus the palette (the palette is per-game, see {@link styleWithPalette}). */
export const BASE_STYLE =
  "Flat 2D vector illustration drawn perfectly straight-on, filling the whole " +
  "canvas edge to edge. This is the printed cover ARTWORK itself, NOT a " +
  "photograph of a box: no 3D box, no product mockup, no perspective, no box " +
  "sides or thickness, no packaging, no shelf, no surrounding background, no " +
  "drop shadow. Bold geometric shapes, thick clean outlines, subtle paper " +
  "grain, no photorealism, no heavy gradients. Strong sans-serif title. " +
  "Prefer scenery, architecture, objects and atmosphere; avoid depicting people " +
  "or human figures, for a warm cozy mood. " +
  "Consistent board-game publisher house style.";

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

export function facePrompt(face: Face, name: string, input: FaceInput): string {
  const style = styleWithPalette(input.palette);
  const parts = [input.description, input.artNote].map((s) => s?.trim()).filter(Boolean);
  const subject = parts.length ? `What it's about: ${parts.join(" ")}` : `Evoke its theme: ${input.theme}.`;
  if (face === "spine") {
    return (
      `A flat 2D vertical STRIP graphic for the board game "${name}", drawn perfectly ` +
      `straight-on and standing ALONE on a solid pure-white (#ffffff) background so it ` +
      `can be cropped out. The strip is a flat tall rectangle, NOT a 3D box, NOT a ` +
      `product render, NO perspective, NO angle, NO box sides/edges/thickness, NO ` +
      `shadow. Inside the strip: an illustrated BACKGROUND scene evoking the game (do ` +
      `NOT copy the front cover), and over it in the FOREGROUND the game name ` +
      `"${name}" ROTATED 90° to run vertically down the strip like a book-spine ` +
      `title, reading TOP-TO-BOTTOM (sideways letters, NOT upright horizontal ` +
      `text), spelled exactly once, large, bold, fully legible and NEVER ` +
      `obstructed, high contrast, running the length of the strip. NO logo, NO ` +
      `emblem, NO icons. ${subject} ${style}`
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
    if (res.status === 429) throw new SourceUnavailableError(BOX_ART_SOURCE, "gemini image rate-limited (429)");
    if (!res.ok) throw new Error(`gemini image ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const inline = data?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData?.data;
    if (!inline) throw new Error(`gemini returned no image for prompt: ${prompt.slice(0, 60)}…`);
    return Uint8Array.from(Buffer.from(inline, "base64"));
  };
}

export interface GenConfig {
  /** GEMINI_API_KEY. When absent the source is inert (discovers nothing). */
  apiKey?: string;
  /** Test seam — defaults to {@link geminiImageGen}. */
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
    this.gen = cfg.gen ?? (cfg.apiKey ? geminiImageGen(cfg.apiKey) : undefined);
  }

  async discover(e: Entity): Promise<DiscoveredAsset[]> {
    if (!this.gen) return [];
    const theme = themeHint(e);
    const key = boxArtKey(e.id, this.kind);
    const prompt = facePrompt(this.kind, e.name, { theme, description: e.description, artNote: e.artNote, palette: e.palette });
    const ratio = aspectRatioFor(this.kind, e.dims);
    const isSpine = this.kind === "spine";
    return [
      {
        key,
        fingerprint: `gen:${STYLE_VERSION}:${this.kind}:${e.name}|${theme}|${e.description ?? ""}|${e.artNote ?? ""}|${(e.palette ?? []).join(",")}`,
        fetch: async () => {
          const raw = await this.gen!(prompt, ratio);
          // Spine stands alone on white — trim to just the strip so the shelf shows only the spine.
          const bytes = isSpine ? await trimBackground(raw) : raw;
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
