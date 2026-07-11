import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Local disk cache for served asset variants, keyed by the game's Obsidian UUID
 * and the image source (a game keeps both BGG and Ludopedia images):
 *
 *   <root>/<uuid>/<source>/original.jpg   — the source's full-res image (from GCS)
 *   <root>/<uuid>/<source>/<W>x<H>.jpg    — a derivative size, resized on demand
 *
 * This disk IS the serving layer: once a variant is here the API never touches
 * GCS or a provider for it again.
 */
export class AssetStore {
  constructor(private readonly root: string) {}

  /** Variant filename for a size, or `original` when no dimensions given. */
  static variant(w?: number, h?: number): string {
    if (w == null && h == null) return "original.jpg";
    return `${w ?? ""}x${h ?? ""}.jpg`;
  }

  private dir(id: string, source: string): string {
    return join(this.root, id, source);
  }
  private path(id: string, source: string, w?: number, h?: number): string {
    return join(this.dir(id, source), AssetStore.variant(w, h));
  }

  has(id: string, source: string, w?: number, h?: number): boolean {
    return existsSync(this.path(id, source, w, h));
  }

  async get(id: string, source: string, w?: number, h?: number): Promise<Uint8Array | null> {
    const p = this.path(id, source, w, h);
    if (!existsSync(p)) return null;
    return new Uint8Array(await readFile(p));
  }

  async put(id: string, source: string, bytes: Uint8Array, w?: number, h?: number): Promise<void> {
    await mkdir(this.dir(id, source), { recursive: true });
    await writeFile(this.path(id, source, w, h), bytes);
  }
}
