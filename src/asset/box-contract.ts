/**
 * The box-art contract: the single source of truth both the generator (which
 * produces the art) and the frontend (which renders the 3D box) import, so the
 * two never disagree on face names, dimensions, format, or asset paths.
 *
 * A physical box has three dimensions; each face maps to a pair of them:
 *
 *        ┌───────────┐
 *        │   top     │  width × depth
 *   ┌────┼───────────┼
 *   │spine│  front   │  front: width × height   spine: depth × height
 *   │    │           │
 *   └────┴───────────┘
 *
 * Only `front` and `spine` are generated today; `top`/`back` slot in here later
 * without any caller changing.
 */
import type { AssetKey } from "./key.ts";

export type Face = "front" | "spine";

/** Physical box dimensions in centimetres. `depthCm` drives the spine + shelf. */
export interface BoxDims {
  widthCm: number;
  heightCm: number;
  depthCm?: number;
}

/** Bump when {@link import("./box-art.ts").HOUSE_STYLE} or prompts change, to re-generate all art. */
export const STYLE_VERSION = "v6";

/** The stored format for generated box art. */
export const BOX_ART_FORMAT = "png" as const;
export const BOX_ART_SOURCE = "gen" as const;

export const FACES: readonly Face[] = ["front", "spine"] as const;

/** Which dimension pair a face is sized by (for aspect-ratio + shelf layout). */
export function faceDims(face: Face, d?: BoxDims): { w?: number; h?: number } {
  if (face === "front") return { w: d?.widthCm, h: d?.heightCm };
  return { w: d?.depthCm, h: d?.heightCm }; // spine
}

/**
 * The asset path both sides use — never hand-build a box-art URL elsewhere.
 * The filename is the {@link STYLE_VERSION}, so each version is a NEW object
 * (`v6.png`) that never overwrites older ones, and the frontend — importing the
 * same constant — always requests the current version.
 */
export function boxArtKey(entity: string, face: Face): AssetKey {
  return { entity, kind: face, source: BOX_ART_SOURCE, variant: STYLE_VERSION, ext: BOX_ART_FORMAT };
}

/** Gemini's supported aspect ratios; a box face snaps to the nearest one. */
const RATIOS: Array<[string, number]> = [
  ["1:1", 1], ["4:5", 0.8], ["5:4", 1.25], ["3:4", 0.75], ["4:3", 1.333],
  ["2:3", 0.667], ["3:2", 1.5], ["9:16", 0.5625], ["16:9", 1.778], ["21:9", 2.333],
];

/** Nearest supported aspect ratio for a face; falls back per-face when dims are unknown. */
export function aspectRatioFor(face: Face, d?: BoxDims): string {
  const { w, h } = faceDims(face, d);
  const fallback = face === "spine" ? "9:16" : "1:1";
  if (!w || !h) return fallback;
  const target = w / h;
  return RATIOS.reduce((best, r) => (Math.abs(r[1] - target) < Math.abs(best[1] - target) ? r : best))[0];
}
