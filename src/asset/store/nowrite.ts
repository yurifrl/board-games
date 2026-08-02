import type { AssetKey } from "../key.ts";
import type { AssetBlob, AssetRecord, BlobStore } from "../types.ts";

/**
 * Wraps a store so reads pass through but writes are no-ops. Used by the local
 * spine-prompt test to read originals (disk-miss → bucket fallback) WITHOUT ever
 * uploading generated art back to the bucket.
 */
export class NoWriteStore implements BlobStore {
  constructor(private readonly inner: BlobStore) {}

  head(key: AssetKey) {
    return this.inner.head(key);
  }

  get(key: AssetKey) {
    return this.inner.get(key);
  }

  async put(key: AssetKey, blob: AssetBlob): Promise<AssetRecord> {
    return { key, contentType: blob.contentType, bytes: blob.bytes.byteLength, fingerprint: blob.fingerprint };
  }

  list(prefix: { entity: string; kind?: string; source?: string }) {
    return this.inner.list(prefix);
  }
}
