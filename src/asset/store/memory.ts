import type { AssetKey } from "../key.ts";
import { keyPath, keyPrefix } from "../key.ts";
import type { AssetBlob, AssetRecord, BlobStore } from "../types.ts";

/**
 * In-memory blob store. The single shared fake for tests, and handy for local
 * runs without GCS. Keyed by the serialized key path, like the real backends.
 */
export class InMemoryBlobStore implements BlobStore {
  private readonly blobs = new Map<string, AssetBlob>();

  async head(key: AssetKey): Promise<AssetRecord | null> {
    const b = this.blobs.get(keyPath(key));
    if (!b) return null;
    return { key, contentType: b.contentType, bytes: b.bytes.byteLength, fingerprint: b.fingerprint };
  }

  async get(key: AssetKey): Promise<AssetBlob | null> {
    const b = this.blobs.get(keyPath(key));
    return b ? { ...b, bytes: new Uint8Array(b.bytes) } : null;
  }

  async put(key: AssetKey, blob: AssetBlob): Promise<AssetRecord> {
    this.blobs.set(keyPath(key), { ...blob, bytes: new Uint8Array(blob.bytes) });
    return { key, contentType: blob.contentType, bytes: blob.bytes.byteLength, fingerprint: blob.fingerprint };
  }

  async list(prefix: { entity: string; kind?: string; source?: string }): Promise<AssetKey[]> {
    const p = keyPrefix(prefix);
    const out: AssetKey[] = [];
    for (const path of this.blobs.keys()) {
      if (!path.startsWith(p)) continue;
      const m = path.match(/^([^/]+)\/([^/]+)\/([^/]+)\/(.+)\.([^.]+)$/);
      if (m) out.push({ entity: m[1], kind: m[2], source: m[3], variant: m[4], ext: m[5] });
    }
    return out;
  }
}
