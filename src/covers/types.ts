/**
 * Cover acquisition subsystem — contracts.
 *
 * A small, source-agnostic pipeline that fills a local cover cache for board
 * games. Providers know how to obtain an image from one source; the resolver
 * orchestrates them by quality tier; the store persists results so the runtime
 * never depends on any remote.
 */

/** The minimal facts any provider may need to locate a game's cover. */
export interface GameRef {
  /** Stable internal note id — the cache key. */
  id: string;
  name: string;
  bggId?: string;
  /** The low-res BGG image URL already stored in the note (image/grid). */
  bggImageUrl?: string;
  ludopediaId?: string;
  ludopediaSlug?: string;
}

/** A successfully obtained cover image, in memory. */
export interface CoverResult {
  bytes: Uint8Array;
  contentType: string;
  /** Provider name, e.g. "ludopedia". */
  source: string;
  /** Quality tier — higher wins. Lets the resolver upgrade over time. */
  tier: number;
  sourceUrl: string;
  /** Source-keyed cache key this cover is stored under, e.g. `ludopedia-15950`. */
  cacheKey: string;
  /**
   * Stable signature of the source this cover was built from (e.g. the note's
   * BGG image URL, or the Ludopedia id). Persisted so the resolver can detect
   * when the source changed in Obsidian and refetch, instead of serving a stale
   * cover forever.
   */
  fingerprint?: string;
}

/** Sidecar metadata persisted next to each cached cover. */
export interface CoverMeta {
  source: string;
  tier: number;
  sourceUrl: string;
  contentType: string;
  bytes: number;
  sha256: string;
  fetchedAt: string;
  /** Source signature at fetch time; a mismatch means the note changed → refetch. */
  sourceFingerprint?: string;
}

/**
 * A pluggable cover source. `fetch` returns null when the provider simply
 * cannot serve this game (no usable identifier), and throws
 * {@link ProviderUnavailableError} when it is temporarily blocked (e.g. rate
 * limited) so the resolver can defer rather than downgrade.
 */
export interface CoverProvider {
  readonly name: string;
  /** Higher = better quality; the resolver tries providers in descending tier. */
  readonly tier: number;
  /**
   * The cache key this provider would use for the game, derivable from the
   * note alone (no network) — or null when this provider can't be keyed up
   * front (e.g. the id must be resolved at fetch time). Used by the resolver to
   * detect an already-cached cover without refetching.
   */
  keyFor(game: GameRef): string | null;
  /**
   * A stable signature of this provider's current source for the game, derivable
   * from the note alone (no network) — e.g. the BGG image URL or the Ludopedia
   * id. The resolver compares it to the cached cover's fingerprint to decide
   * whether the source changed and the cover must be refetched. Return null when
   * it can't be known up front (then the cached cover is assumed still current).
   */
  fingerprint(game: GameRef): string | null;
  fetch(game: GameRef): Promise<CoverResult | null>;
}

/** Persists cover bytes + metadata under a stable id. */
export interface CoverStore {
  has(id: string): Promise<boolean>;
  meta(id: string): Promise<CoverMeta | null>;
  write(id: string, result: CoverResult): Promise<CoverMeta>;
}

/** Thrown by a provider that is temporarily unavailable (rate limit, outage). */
export class ProviderUnavailableError extends Error {
  constructor(
    readonly provider: string,
    message: string,
  ) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}
