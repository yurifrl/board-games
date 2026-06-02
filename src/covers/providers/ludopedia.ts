import { ProviderUnavailableError, type CoverProvider, type CoverResult, type GameRef } from "../types.ts";
import { coverKey } from "../keys.ts";

const CAPAS = (id: string | number) => `https://storage.googleapis.com/ludopedia-capas/${id}.jpg`;
const API = "https://ludopedia.com.br/api/v1";

export interface LudopediaConfig {
  /** OAuth access token — enables resolving a game's id by slug/name search. */
  token?: string;
  /** Session cookie header — enables resolving a game's id from its public page. */
  cookie?: string;
  userAgent?: string;
}

/**
 * Ludopedia cover. Full-resolution and served from a public, unauthenticated
 * Google Storage bucket keyed by the game's numeric id, so the image fetch
 * itself never needs credentials or hits a rate limit.
 *
 * Obtaining the id when the note doesn't already have one is the only part that
 * touches the (heavily rate-limited) Ludopedia API/website, and only happens
 * when a token/cookie is configured. When that resolution is throttled the
 * provider raises {@link ProviderUnavailableError} so the resolver defers
 * instead of permanently downgrading to a worse source.
 */
export class LudopediaProvider implements CoverProvider {
  readonly name = "ludopedia";
  readonly tier = 30;
  private readonly ua: string;

  constructor(private readonly cfg: LudopediaConfig = {}) {
    this.ua = cfg.userAgent ?? "Mozilla/5.0 Chrome/120";
  }

  keyFor(game: GameRef): string | null {
    return game.ludopediaId ? coverKey("ludopedia", game.ludopediaId) : null;
  }

  async fetch(game: GameRef): Promise<CoverResult | null> {
    const id = game.ludopediaId ?? (await this.resolveId(game));
    if (!id) return null;
    const url = CAPAS(id);
    const r = await fetch(url);
    if (!r.ok) return null;
    return {
      bytes: new Uint8Array(await r.arrayBuffer()),
      contentType: r.headers.get("content-type") ?? "image/jpeg",
      source: this.name,
      tier: this.tier,
      sourceUrl: url,
      cacheKey: coverKey("ludopedia", id),
    };
  }

  /** Resolve a numeric id from the slug (page) or name (API), if creds allow. */
  private async resolveId(game: GameRef): Promise<string | null> {
    if (game.ludopediaSlug && this.cfg.cookie) {
      const r = await fetch(`https://ludopedia.com.br/jogo/${game.ludopediaSlug}`, {
        headers: { "User-Agent": this.ua, Cookie: this.cfg.cookie },
      });
      if (r.status === 429) throw new ProviderUnavailableError(this.name, "page rate-limited (429)");
      const id = (await r.text()).match(/ludopedia-capas\/(\d+)/)?.[1];
      if (id) return id;
    }
    if (this.cfg.token) {
      const r = await fetch(`${API}/jogos?search=${encodeURIComponent(game.name)}&rows=20`, {
        headers: { Authorization: `Bearer ${this.cfg.token}` },
      });
      if (r.status === 429) throw new ProviderUnavailableError(this.name, "api rate-limited (429)");
      if (!r.ok) return null;
      const data = (await r.json()) as { jogos?: Array<{ id_jogo: number; link: string }> };
      const jogos = data.jogos ?? [];
      const slug = game.ludopediaSlug;
      const hit = slug ? jogos.find((j) => (j.link || "").replace(/^jogo\//, "").toLowerCase() === slug) : null;
      if (hit) return String(hit.id_jogo);
    }
    return null;
  }
}
