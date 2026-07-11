import { SourceUnavailableError, type AssetBlob, type AssetSource, type DiscoveredAsset, type Entity } from "../types.ts";

const CAPAS = (id: string | number) => `https://storage.googleapis.com/ludopedia-capas/${id}.jpg`;
const API = "https://ludopedia.com.br/api/v1";

export interface LudopediaConfig {
  token?: string;
  cookie?: string;
  userAgent?: string;
}

/**
 * Ludopedia cover. Full-res, served from a public GCS bucket keyed by the game's
 * numeric id (no credentials, no rate limit). Resolving the id from a slug/name
 * (when the note lacks it) is the only credentialed, rate-limited step; it
 * raises {@link SourceUnavailableError} on a 429 so the pipeline defers.
 * Fingerprinted by the id.
 */
export class LudopediaCoverSource implements AssetSource {
  readonly id = "ludopedia";
  readonly kind = "cover";
  readonly priority = 30;
  private readonly ua: string;

  constructor(private readonly cfg: LudopediaConfig = {}) {
    this.ua = cfg.userAgent ?? "Mozilla/5.0 Chrome/120";
  }

  async discover(e: Entity): Promise<DiscoveredAsset[]> {
    const id = e.ludopediaId ?? (await this.resolveId(e));
    if (!id) return [];
    const url = CAPAS(id);
    return [
      {
        key: { entity: e.id, kind: this.kind, source: this.id, variant: "original", ext: "jpg" },
        fingerprint: String(id),
        fetch: async (): Promise<AssetBlob> => {
          const r = await fetch(url);
          if (!r.ok) throw new Error(`ludopedia capa ${r.status}`);
          return {
            bytes: new Uint8Array(await r.arrayBuffer()),
            contentType: r.headers.get("content-type") ?? "image/jpeg",
            fingerprint: String(id),
          };
        },
      },
    ];
  }

  /** Resolve a numeric id from the slug (page) or name (API), if creds allow. */
  private async resolveId(e: Entity): Promise<string | null> {
    if (e.ludopediaSlug && this.cfg.cookie) {
      const r = await fetch(`https://ludopedia.com.br/jogo/${e.ludopediaSlug}`, {
        headers: { "User-Agent": this.ua, Cookie: this.cfg.cookie },
      });
      if (r.status === 429) throw new SourceUnavailableError(this.id, "page rate-limited (429)");
      const id = (await r.text()).match(/ludopedia-capas\/(\d+)/)?.[1];
      if (id) return id;
    }
    if (this.cfg.token) {
      const r = await fetch(`${API}/jogos?search=${encodeURIComponent(e.name)}&rows=20`, {
        headers: { Authorization: `Bearer ${this.cfg.token}` },
      });
      if (r.status === 429) throw new SourceUnavailableError(this.id, "api rate-limited (429)");
      if (!r.ok) return null;
      const data = (await r.json()) as { jogos?: Array<{ id_jogo: number; link: string }> };
      const slug = e.ludopediaSlug;
      const hit = slug ? (data.jogos ?? []).find((j) => (j.link || "").replace(/^jogo\//, "").toLowerCase() === slug) : null;
      if (hit) return String(hit.id_jogo);
    }
    return null;
  }
}
