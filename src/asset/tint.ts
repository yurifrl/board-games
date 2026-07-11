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
