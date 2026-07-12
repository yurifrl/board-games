import sharp from "sharp";
import { join } from "node:path";

// Per-cover visual info, memoized: dominant color (#rrggbb) for the box tint
// and the image aspect ratio (width/height) so the box takes the shape of its
// actual cover instead of a preset. Missing/failed covers return {} so the CSS
// falls back to neutrals.
export type CoverInfo = { tint?: string; aspect?: number };

const memo = new Map<string, CoverInfo>();

export async function coverInfo(coversDir: string, key: string): Promise<CoverInfo> {
  const hit = memo.get(key);
  if (hit) return hit;
  try {
    const img = sharp(join(coversDir, key, "cover.jpg"));
    const [{ dominant }, { width, height }] = await Promise.all([img.stats(), img.metadata()]);
    const hex = "#" + [dominant.r, dominant.g, dominant.b].map((n) => n.toString(16).padStart(2, "0")).join("");
    const info: CoverInfo = { tint: hex, aspect: width && height ? width / height : undefined };
    memo.set(key, info);
    return info;
  } catch {
    return {};
  }
}
