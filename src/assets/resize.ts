import sharp from "sharp";

/**
 * Resize/crop an image to the requested box, returning JPEG bytes. Called once
 * per (uuid, size); the result is cached on disk by AssetStore, so this never
 * runs twice for the same variant.
 *
 * - both w & h: cover-crop to exactly WxH (fill the box, center-crop overflow)
 * - only one: scale to that dimension, keep aspect ratio
 * - neither: re-encode the original as JPEG unchanged
 */
export async function resize(bytes: Uint8Array, w?: number, h?: number): Promise<Uint8Array> {
  let img = sharp(bytes);
  if (w != null || h != null) {
    img = img.resize({
      width: w,
      height: h,
      fit: w != null && h != null ? "cover" : "inside",
      withoutEnlargement: true,
    });
  }
  return new Uint8Array(await img.jpeg({ quality: 82 }).toBuffer());
}
