import sharp from "sharp";
import type { AssetBlob, AssetRenderer } from "../types.ts";

/**
 * Cover renderer: resize/crop to the requested box (cover-crop when both w & h,
 * scale-to-fit when one, re-encode JPEG when neither). Resize-once — the service
 * caches the result under the variant key.
 */
export class ImageRenderer implements AssetRenderer {
  readonly kind = "cover";

  variantName(p: URLSearchParams): string {
    const w = p.get("w");
    const h = p.get("h");
    if (!w && !h) return "original";
    return `${w ?? ""}x${h ?? ""}`;
  }

  async render(blob: AssetBlob, p: URLSearchParams): Promise<AssetBlob> {
    const w = p.get("w") ? Number(p.get("w")) : undefined;
    const h = p.get("h") ? Number(p.get("h")) : undefined;
    let img = sharp(blob.bytes);
    if (w != null || h != null) {
      img = img.resize({ width: w, height: h, fit: w != null && h != null ? "cover" : "inside", withoutEnlargement: true });
    }
    return { bytes: new Uint8Array(await img.jpeg({ quality: 82 }).toBuffer()), contentType: "image/jpeg" };
  }
}
