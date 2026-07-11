import type { AssetKey } from "./key.ts";

/** Asset bytes in memory, with their content type and a source fingerprint. */
export interface AssetBlob {
  bytes: Uint8Array;
  contentType: string;
  /**
   * Stable signature of the upstream source (BGG image URL, Ludopedia id,
   * uploaded file sha). Change detection compares this; unchanged sources are
   * never refetched.
   */
  fingerprint?: string;
}

/** What a store knows about a stored asset without downloading its bytes. */
export interface AssetRecord {
  key: AssetKey;
  contentType: string;
  bytes: number;
  fingerprint?: string;
}

/**
 * A content-addressable blob store keyed by {@link AssetKey}. GCS (durable
 * origin) and local disk (cache) both implement it; {@link TieredBlobStore}
 * composes them. This is the ONLY storage seam — pull sources, the push ingest
 * API, and the serving path all go through it.
 */
export interface BlobStore {
  head(key: AssetKey): Promise<AssetRecord | null>;
  get(key: AssetKey): Promise<AssetBlob | null>;
  put(key: AssetKey, blob: AssetBlob): Promise<AssetRecord>;
  /** Keys under a prefix (e.g. all of a game's rulebooks). */
  list(prefix: { entity: string; kind?: string; source?: string }): Promise<AssetKey[]>;
}

/** A discoverable-then-fetchable asset from a pull source. */
export interface DiscoveredAsset {
  key: AssetKey;
  fingerprint: string;
  /** Lazy — only invoked when the store says the source changed. */
  fetch(): Promise<AssetBlob>;
}

/** An entity we can gather assets for (a game). Sources read only what they need. */
export interface Entity {
  id: string;
  name: string;
  bggId?: string;
  bggImageUrl?: string;
  ludopediaId?: string;
  ludopediaSlug?: string;
}

/**
 * A pull source: knows how to discover (and lazily fetch) the assets it can
 * provide for an entity. Adding a source or asset kind = one new implementation
 * registered in sources/registry.ts — no branching anywhere else.
 */
export interface AssetSource {
  readonly id: string;
  readonly kind: string;
  /** Higher wins when picking a default source to serve. */
  readonly priority: number;
  discover(entity: Entity): Promise<DiscoveredAsset[]>;
}

/** A serve-time transform keyed by asset kind (cover → resize, rulebook → identity). */
export interface AssetRenderer {
  readonly kind: string;
  /** Cache key for the rendition these params produce ("original" when no transform). */
  variantName(params: URLSearchParams): string;
  render(blob: AssetBlob, params: URLSearchParams): Promise<AssetBlob>;
}

/** Thrown by a source that is temporarily unavailable (rate limit, outage). */
export class SourceUnavailableError extends Error {
  constructor(
    readonly source: string,
    message: string,
  ) {
    super(message);
    this.name = "SourceUnavailableError";
  }
}
