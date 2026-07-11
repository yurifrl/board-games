import { SourceUnavailableError, type AssetBlob, type AssetSource, type DiscoveredAsset, type Entity } from "../types.ts";

const UA = "Mozilla/5.0 Chrome/120";

export interface BggConfig {
  /** BGG API bearer token (BGG_BEARER_TOKEN) — the XML API is 401 without it. */
  bearerToken?: string;
}

/**
 * BoardGameGeek cover, fetched from the source by `bgg/id` via the XML API
 * (`xmlapi2/thing`), which returns the primary `<image>` at full resolution.
 * The note's `image/grid` thumbnail is NOT used — the id is the source of
 * truth. Fingerprinted by the id, so re-mapping a game's `bgg/id` refetches;
 * editing unrelated fields doesn't.
 */
export class BggCoverSource implements AssetSource {
  readonly id = "bgg";
  readonly kind = "cover";
  readonly priority = 20;

  constructor(private readonly cfg: BggConfig = {}) {}

  async discover(e: Entity): Promise<DiscoveredAsset[]> {
    if (!e.bggId) return [];
    const bggId = e.bggId;
    return [
      {
        key: { entity: e.id, kind: this.kind, source: this.id, variant: "original", ext: "jpg" },
        fingerprint: `bgg:${bggId}`,
        fetch: () => this.fetchCover(bggId),
      },
    ];
  }

  private async fetchCover(bggId: string): Promise<AssetBlob> {
    const headers: Record<string, string> = { "User-Agent": UA };
    if (this.cfg.bearerToken) headers.Authorization = `Bearer ${this.cfg.bearerToken}`;
    const meta = await fetch(`https://boardgamegeek.com/xmlapi2/thing?id=${bggId}`, { headers });
    if (meta.status === 429) throw new SourceUnavailableError(this.id, "xmlapi rate-limited (429)");
    if (!meta.ok) throw new Error(`bgg xmlapi ${meta.status}`);
    const imageUrl = (await meta.text()).match(/<image>([^<]+)<\/image>/)?.[1];
    if (!imageUrl) throw new Error(`bgg ${bggId}: no <image>`);

    const img = await fetch(imageUrl, { headers: { "User-Agent": UA } });
    if (!img.ok) throw new Error(`bgg image ${img.status}`);
    return {
      bytes: new Uint8Array(await img.arrayBuffer()),
      contentType: img.headers.get("content-type") ?? "image/jpeg",
      fingerprint: `bgg:${bggId}`,
    };
  }
}
