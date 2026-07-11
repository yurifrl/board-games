import { Storage } from "@google-cloud/storage";

/**
 * Thin wrapper over the private GCS bucket. The API is the only credential
 * holder (SA key JSON from GOOGLE_APPLICATION_CREDENTIALS / the mounted
 * board-games-gcs-creds secret), so nothing else can read the bucket and cost
 * stays bounded to this service.
 *
 * `bucket` is injectable so tests can pass a fake without touching GCS.
 */
export interface GcsBucketLike {
  file(key: string): {
    exists(): Promise<[boolean]>;
    download(): Promise<[Buffer]>;
    save(data: Buffer | Uint8Array, opts?: { contentType?: string }): Promise<void>;
  };
}

export class GcsStore {
  private readonly bucket: GcsBucketLike;

  constructor(bucketName?: string, bucket?: GcsBucketLike) {
    if (bucket) {
      this.bucket = bucket;
      return;
    }
    const name = bucketName ?? process.env.ASSETS_GCS_BUCKET;
    if (!name) throw new Error("ASSETS_GCS_BUCKET is not set");
    this.bucket = new Storage().bucket(name);
  }

  async head(key: string): Promise<boolean> {
    const [exists] = await this.bucket.file(key).exists();
    return exists;
  }

  async get(key: string): Promise<Uint8Array | null> {
    const file = this.bucket.file(key);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [buf] = await file.download();
    return new Uint8Array(buf);
  }

  async put(key: string, bytes: Uint8Array, contentType = "image/jpeg"): Promise<void> {
    await this.bucket.file(key).save(bytes, { contentType });
  }
}
