import sharp from "sharp";
import type { AssetBlob } from "./types.ts";

/**
 * Dominant color of an image as `#rrggbb`, used to tint the 3D box + stage in
 * the UI. Downscales to a single pixel (sharp's box average) — cheap and stable.
 * Returns null on undecodable bytes.
 */
export async function dominantColor(blob: AssetBlob): Promise<string | null> {
  try {
    const { data } = await sharp(blob.bytes).resize(1, 1, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const hex = (n: number) => n.toString(16).padStart(2, "0");
    return `#${hex(data[0])}${hex(data[1])}${hex(data[2])}`;
  } catch {
    return null;
  }
}

/**
 * A small representative palette (`#rrggbb[]`, most-frequent first) of an image,
 * used to derive generated box art from a game's real cover. Downscales to an
 * 8×8 grid and buckets colors into coarse bins so near-identical shades merge.
 */
export async function palette(blob: AssetBlob, n = 5): Promise<string[]> {
  try {
    const { data } = await sharp(blob.bytes).resize(8, 8, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const hex = (v: number) => Math.min(255, Math.round(v / 32) * 32).toString(16).padStart(2, "0");
    const counts = new Map<string, number>();
    for (let i = 0; i < data.length; i += 3) {
      const key = `#${hex(data[i])}${hex(data[i + 1])}${hex(data[i + 2])}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([c]) => c);
  } catch {
    return [];
  }
}

/** Trim a uniform (white) border so an image becomes just its content. */
export async function trimBackground(bytes: Uint8Array, background = "#ffffff"): Promise<Uint8Array> {
  try {
    return new Uint8Array(await sharp(bytes).trim({ background, threshold: 30 }).png().toBuffer());
  } catch {
    return bytes;
  }
}
