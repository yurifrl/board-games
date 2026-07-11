import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import type { AssetKey } from "../key.ts";
import { keyPath, keyPrefix, parseKey } from "../key.ts";
import type { AssetBlob, AssetRecord, BlobStore } from "../types.ts";

interface Sidecar {
  contentType: string;
  fingerprint?: string;
  sha256: string;
}

/**
 * Local-disk blob store. The blob lives at `<root>/<keyPath>`, with a
 * `<keyPath>.meta` JSON sidecar holding contentType + fingerprint + sha. Used as
 * the cache tier (originals mirrored from GCS + on-demand derivatives).
 */
export class DiskBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  private file(key: AssetKey): string {
    return join(this.root, keyPath(key));
  }

  async head(key: AssetKey): Promise<AssetRecord | null> {
    const f = this.file(key);
    if (!existsSync(f)) return null;
    const side = await this.sidecar(f);
    const bytes = existsSync(f) ? (await readFile(f)).byteLength : 0;
    return { key, contentType: side?.contentType ?? "application/octet-stream", bytes, fingerprint: side?.fingerprint };
  }

  async get(key: AssetKey): Promise<AssetBlob | null> {
    const f = this.file(key);
    if (!existsSync(f)) return null;
    const side = await this.sidecar(f);
    return {
      bytes: new Uint8Array(await readFile(f)),
      contentType: side?.contentType ?? "application/octet-stream",
      fingerprint: side?.fingerprint,
    };
  }

  async put(key: AssetKey, blob: AssetBlob): Promise<AssetRecord> {
    const f = this.file(key);
    await mkdir(dirname(f), { recursive: true });
    const sha256 = createHash("sha256").update(blob.bytes).digest("hex");
    await writeFile(f, blob.bytes);
    const side: Sidecar = { contentType: blob.contentType, fingerprint: blob.fingerprint, sha256 };
    await writeFile(`${f}.meta`, JSON.stringify(side));
    return { key, contentType: blob.contentType, bytes: blob.bytes.byteLength, fingerprint: blob.fingerprint };
  }

  async list(prefix: { entity: string; kind?: string; source?: string }): Promise<AssetKey[]> {
    const dir = join(this.root, keyPrefix(prefix));
    if (!existsSync(dir)) return [];
    const out: AssetKey[] = [];
    const walk = async (d: string) => {
      for (const e of await readdir(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) await walk(p);
        else if (!e.name.endsWith(".meta")) {
          const rel = p.slice(this.root.length + 1);
          const k = parseKey(rel);
          if (k) out.push(k);
        }
      }
    };
    await walk(dir);
    return out;
  }

  private async sidecar(file: string): Promise<Sidecar | null> {
    try {
      return JSON.parse(await readFile(`${file}.meta`, "utf8")) as Sidecar;
    } catch {
      return null;
    }
  }
}
