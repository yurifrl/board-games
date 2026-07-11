import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Local disk cache for served asset variants. Flat, keyed by the game's
 * Obsidian UUID:
 *
 *   <root>/<uuid>/original.jpg    — the best provider image (also mirrored in GCS)
 *   <root>/<uuid>/<W>x<H>.jpg     — a derivative size, resized on demand and cached
 *
 * This disk IS the serving layer: once a variant is here the API never touches
 * GCS or a provider for it again. Generalizes src/covers/store.ts.
 */
export class AssetStore {
  constructor(private readonly root: string) {}

  /** Variant filename for a size, or `original` when no dimensions given. */
  static variant(w?: number, h?: number): string {
    if (w == null && h == null) return "original.jpg";
    return `${w ?? ""}x${h ?? ""}.jpg`;
  }

  private path(id: string, w?: number, h?: number): string {
    return join(this.root, id, AssetStore.variant(w, h));
  }

  has(id: string, w?: number, h?: number): boolean {
    return existsSync(this.path(id, w, h));
  }

  async get(id: string, w?: number, h?: number): Promise<Uint8Array | null> {
    const p = this.path(id, w, h);
    if (!existsSync(p)) return null;
    return new Uint8Array(await readFile(p));
  }

  async put(id: string, bytes: Uint8Array, w?: number, h?: number): Promise<void> {
    const p = this.path(id, w, h);
    await mkdir(join(this.root, id), { recursive: true });
    await writeFile(p, bytes);
  }
}
