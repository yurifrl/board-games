import { Storage } from "@google-cloud/storage";
import type { AssetKey } from "../key.ts";
import { keyPath, keyPrefix, parseKey } from "../key.ts";
import type { AssetBlob, AssetRecord, BlobStore } from "../types.ts";

/** Minimal structural view of the GCS bucket we use — lets tests inject a fake. */
export interface GcsBucketLike {
  file(path: string): {
    exists(): Promise<[boolean]>;
    download(): Promise<[Buffer]>;
    save(data: Buffer | Uint8Array, opts?: { contentType?: string; metadata?: { metadata?: Record<string, string> } }): Promise<void>;
    getMetadata(): Promise<[{ contentType?: string; size?: string | number; metadata?: Record<string, string | number | boolean | null> }, ...unknown[]]>;
  };
  getFiles(opts: { prefix: string }): Promise<[Array<{ name: string }>, ...unknown[]]>;
}

/**
 * GCS-backed blob store — the durable origin (private bucket, only this app's
 * service account can read/write). The source fingerprint is stored as object
 * custom metadata so change detection needs no separate index.
 */
export class GcsBlobStore implements BlobStore {
  private readonly bucket: GcsBucketLike;

  constructor(bucketName?: string, bucket?: GcsBucketLike) {
    if (bucket) {
      this.bucket = bucket;
      return;
    }
    const name = bucketName ?? process.env.ASSETS_GCS_BUCKET;
    if (!name) throw new Error("ASSETS_GCS_BUCKET is not set");
    this.bucket = new Storage().bucket(name) as unknown as GcsBucketLike;
  }

  async head(key: AssetKey): Promise<AssetRecord | null> {
    const f = this.bucket.file(keyPath(key));
    const [exists] = await f.exists();
    if (!exists) return null;
    const [md] = await f.getMetadata();
    return {
      key,
      contentType: md.contentType ?? "application/octet-stream",
      bytes: Number(md.size ?? 0),
      fingerprint: md.metadata?.fingerprint == null ? undefined : String(md.metadata.fingerprint),
    };
  }

  async get(key: AssetKey): Promise<AssetBlob | null> {
    const f = this.bucket.file(keyPath(key));
    const [exists] = await f.exists();
    if (!exists) return null;
    const [buf] = await f.download();
    const [md] = await f.getMetadata();
    return {
      bytes: new Uint8Array(buf),
      contentType: md.contentType ?? "application/octet-stream",
      fingerprint: md.metadata?.fingerprint == null ? undefined : String(md.metadata.fingerprint),
    };
  }

  async put(key: AssetKey, blob: AssetBlob): Promise<AssetRecord> {
    await this.bucket.file(keyPath(key)).save(blob.bytes, {
      contentType: blob.contentType,
      ...(blob.fingerprint ? { metadata: { metadata: { fingerprint: blob.fingerprint } } } : {}),
    });
    return { key, contentType: blob.contentType, bytes: blob.bytes.byteLength, fingerprint: blob.fingerprint };
  }

  async list(prefix: { entity: string; kind?: string; source?: string }): Promise<AssetKey[]> {
    const [files] = await this.bucket.getFiles({ prefix: keyPrefix(prefix) });
    return files.map((f) => parseKey(f.name)).filter((k): k is AssetKey => k !== null);
  }
}
