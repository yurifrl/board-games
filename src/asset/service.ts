import { createHash } from "node:crypto";
import type { AssetKey } from "./key.ts";
import { variantKey } from "./key.ts";
import type { AssetBlob, AssetRecord, AssetRenderer, BlobStore } from "./types.ts";

const identity: AssetRenderer = {
  kind: "*",
  variantName: () => "original",
  render: async (b) => b,
};

/** Short content tag so a changed original invalidates its cached derivatives. */
const tag = (fingerprint?: string): string =>
  createHash("sha256").update(fingerprint ?? "none").digest("hex").slice(0, 12);

/**
 * Orchestrates the two storage tiers and the renderers. This is the composition
 * point: pull sources and the ingest API call {@link put}; the serve route calls
 * {@link render}. Originals live durably in the origin (GCS) and are mirrored to
 * the cache (disk); derivatives (e.g. resized covers) live only in the cache,
 * regenerated on demand from the original.
 */
export class AssetService {
  constructor(
    private readonly origin: BlobStore,
    private readonly cache: BlobStore,
    private readonly renderers: Map<string, AssetRenderer>,
  ) {}

  /** Write an original to both tiers (durable + local). */
  async put(key: AssetKey, blob: AssetBlob): Promise<AssetRecord> {
    const rec = await this.origin.put(key, blob);
    await this.cache.put(key, blob);
    return rec;
  }

  /** True when the origin has no copy, or a copy with a different fingerprint. */
  async needsUpdate(key: AssetKey, fingerprint: string): Promise<boolean> {
    const rec = await this.origin.head(key);
    return rec == null || rec.fingerprint !== fingerprint;
  }

  /** Keys under a prefix (e.g. a game's rulebooks), read from the durable origin. */
  list(prefix: { entity: string; kind?: string; source?: string }): Promise<AssetKey[]> {
    return this.origin.list(prefix);
  }

  /**
   * Serve `baseKey` (an original) rendered per `params`. Returns null when the
   * original doesn't exist anywhere. Derivatives are cached on disk under a key
   * tagged with the original's fingerprint, so refreshing the original (e.g. a
   * changed image in Obsidian) invalidates the old resized variants instead of
   * serving them forever.
   */
  async render(baseKey: AssetKey, params: URLSearchParams): Promise<AssetBlob | null> {
    const renderer = this.renderers.get(baseKey.kind) ?? identity;
    const variant = renderer.variantName(params);
    if (variant === "original") return this.original(baseKey);

    // Cheap fingerprint (disk sidecar / GCS metadata) -> variant cache probe.
    const head = (await this.cache.head(baseKey)) ?? (await this.origin.head(baseKey));
    if (head) {
      const cached = await this.cache.get(variantKey(baseKey, `${variant}-${tag(head.fingerprint)}`));
      if (cached) return cached;
    }

    const original = await this.original(baseKey);
    if (!original) return null;
    const vk = variantKey(baseKey, `${variant}-${tag(original.fingerprint)}`);
    const out = await renderer.render(original, params);
    await this.cache.put(vk, out);
    return out;
  }

  /** Original bytes: cache first, else pull from origin into the cache. */
  private async original(key: AssetKey): Promise<AssetBlob | null> {
    const local = await this.cache.get(key);
    if (local) return local;
    const remote = await this.origin.get(key);
    if (!remote) return null;
    await this.cache.put(key, remote);
    return remote;
  }
}
