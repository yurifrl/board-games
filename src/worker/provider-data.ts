import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Game } from "../games.ts";

export type ProviderSnapshot = { id: string; fetchedAt: number; data: unknown };

export type ProviderFacts = {
  year?: number;
  minPlayers?: number;
  maxPlayers?: number;
  playTime?: number;
  minAge?: number;
  complexity?: number;
  rating?: number;
  rank?: number;
  type?: string;
  mechanics: string[];
  categories: string[];
  designers: string[];
  publishers: string[];
  languageDependency?: string;
};

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type Options = {
  dataDir: string;
  bggToken?: string;
  ludopediaToken?: string;
  ttlMs?: number;
  now?: () => number;
  fetch?: Fetcher;
};

const emptyFacts = (): ProviderFacts => ({ mechanics: [], categories: [], designers: [], publishers: [] });
const number = (value: unknown): number | undefined => {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};
const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;

function attrs(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], decodeXml(m[2])]));
}

function decodeXml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

export function normalizeBgg(xml: string): ProviderFacts {
  const out = emptyFacts();
  const item = xml.match(/<item\b[^>]*>/)?.[0] ?? "";
  const value = (name: string) => attrs(xml.match(new RegExp(`<${name}\\b[^>]*>`))?.[0] ?? "").value;
  const links = [...xml.matchAll(/<link\b[^>]*>/g)].map((m) => attrs(m[0]));
  const values = (kind: string) => links.filter((link) => link.type === kind).map((link) => link.value).filter(Boolean);
  const language = xml.match(/<poll\b[^>]*name="language_dependence"[^>]*>[\s\S]*?<\/poll>/)?.[0];
  const languageVotes = language
    ? [...language.matchAll(/<result\b[^>]*>/g)].map((m) => attrs(m[0])).sort((a, b) => Number(b.numvotes) - Number(a.numvotes))
    : [];

  out.year = number(value("yearpublished"));
  out.minPlayers = number(value("minplayers"));
  out.maxPlayers = number(value("maxplayers"));
  out.playTime = number(value("playingtime"));
  out.minAge = number(value("minage"));
  out.rating = number(value("average"));
  out.complexity = number(value("averageweight"));
  out.rank = number(attrs(xml.match(/<rank\b[^>]*name="boardgame"[^>]*>/)?.[0] ?? "").value);
  out.type = attrs(item).type;
  out.mechanics = values("boardgamemechanic");
  out.categories = values("boardgamecategory");
  out.designers = values("boardgamedesigner");
  out.publishers = values("boardgamepublisher");
  out.languageDependency = languageVotes[0]?.value;
  return out;
}

function names(data: Record<string, unknown>, key: string, fields: string[]): string[] {
  const list = data[key];
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    if (typeof item === "string") return item.trim() ? [item.trim()] : [];
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const value = fields.map((field) => text(record[field])).find(Boolean);
    return value ? [value] : [];
  });
}

export function normalizeLudopedia(value: unknown): ProviderFacts {
  const data = value && typeof value === "object" && "detail" in value
    ? ((value as Record<string, unknown>).detail as Record<string, unknown>)
    : (value as Record<string, unknown> | null) ?? {};
  return {
    year: number(data.ano_publicacao),
    minPlayers: number(data.qt_jogadores_min),
    maxPlayers: number(data.qt_jogadores_max),
    playTime: number(data.vl_tempo_jogo),
    minAge: number(data.idade_minima),
    complexity: number(data.vl_peso ?? data.complexidade),
    rating: number(data.vl_nota_media ?? data.nota_media),
    rank: number(data.nr_rank ?? data.ranking),
    type: text(data.tp_jogo),
    mechanics: names(data, "mecanicas", ["nm_mecanica", "nome"]),
    categories: names(data, "categorias", ["nm_categoria", "nome"]),
    designers: names(data, "designers", ["nm_designer", "nome"]),
    publishers: names(data, "editoras", ["nm_editora", "nome"]),
    languageDependency: text(data.dependencia_idioma ?? data.nm_dependencia_idioma),
  };
}

function mergeFacts(primary?: ProviderFacts, fallback?: ProviderFacts): ProviderFacts | undefined {
  if (!primary && !fallback) return undefined;
  const a = primary ?? emptyFacts();
  const b = fallback ?? emptyFacts();
  return {
    year: a.year ?? b.year,
    minPlayers: a.minPlayers ?? b.minPlayers,
    maxPlayers: a.maxPlayers ?? b.maxPlayers,
    playTime: a.playTime ?? b.playTime,
    minAge: a.minAge ?? b.minAge,
    complexity: a.complexity ?? b.complexity,
    rating: a.rating ?? b.rating,
    rank: a.rank ?? b.rank,
    type: a.type ?? b.type,
    mechanics: a.mechanics.length ? a.mechanics : b.mechanics,
    categories: a.categories.length ? a.categories : b.categories,
    designers: a.designers.length ? a.designers : b.designers,
    publishers: a.publishers.length ? a.publishers : b.publishers,
    languageDependency: a.languageDependency ?? b.languageDependency,
  };
}

const cachePath = (root: string, provider: string, id: string) => join(root, "providers", provider, `${id}.json`);

async function readSnapshot(path: string): Promise<ProviderSnapshot | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as ProviderSnapshot;
  } catch {
    return undefined;
  }
}

async function writeSnapshot(path: string, snapshot: ProviderSnapshot): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(snapshot));
  await rename(tmp, path);
}

function bggItems(xml: string): Map<string, string> {
  const items = new Map<string, string>();
  let depth = 0;
  let start = 0;
  let id: string | undefined;
  for (const token of xml.matchAll(/<item\b[^>]*>|<\/item>/g)) {
    if (token[0] === "</item>") {
      depth--;
      if (depth === 0 && id) items.set(id, xml.slice(start, token.index + token[0].length));
      continue;
    }
    if (depth === 0) {
      start = token.index;
      id = attrs(token[0]).id;
    }
    depth++;
  }
  return items;
}

async function fetchLudopedia(id: string, token: string, request: Fetcher): Promise<unknown> {
  const headers = { Authorization: `Bearer ${token}` };
  const get = async (suffix: string, required = false) => {
    const response = await request(`https://ludopedia.com.br/api/v1/jogos/${id}${suffix}`, { headers });
    if (!response.ok) {
      if (!required && response.status === 404) return null;
      throw new Error(`ludopedia ${id}: ${response.status}`);
    }
    return response.json();
  };
  return {
    detail: await get("", true),
    ratings: await get("/notas?rows=100"),
    videos: await get("/videos?rows=100"),
    images: await get("/imagens?rows=100"),
    files: await get("/aquivos?rows=100"),
  };
}

export async function enrichProviderData(games: Game[], options: Options): Promise<void> {
  const now = options.now ?? Date.now;
  const current = now();
  const ttl = options.ttlMs ?? 86_400_000;
  const request = options.fetch ?? globalThis.fetch;
  const snapshots = new Map<string, ProviderSnapshot>();
  const stale = new Map<string, ProviderSnapshot>();
  const bggMisses = new Set<string>();
  const ludoMisses = new Set<string>();

  for (const game of games) {
    for (const [provider, id] of [["bgg", game.bggId], ["ludopedia", game.ludopediaId]] as const) {
      if (!id) continue;
      const snapshot = await readSnapshot(cachePath(options.dataDir, provider, id));
      const key = `${provider}:${id}`;
      if (snapshot) stale.set(key, snapshot);
      if (snapshot && current - snapshot.fetchedAt < ttl) snapshots.set(key, snapshot);
      else if (provider === "bgg") bggMisses.add(id);
      else ludoMisses.add(id);
    }
  }

  if (options.bggToken) {
    const ids = [...bggMisses];
    for (let offset = 0; offset < ids.length; offset += 20) {
      const batch = ids.slice(offset, offset + 20);
      try {
        const url = `https://boardgamegeek.com/xmlapi2/thing?id=${batch.map(encodeURIComponent).join(",")}&stats=1&versions=1&videos=1`;
        const response = await request(url, { headers: { Authorization: `Bearer ${options.bggToken}`, "User-Agent": "board-games-catalog/0.1" } });
        if (!response.ok) throw new Error(`bgg: ${response.status}`);
        const items = bggItems(await response.text());
        for (const id of batch) {
          const data = items.get(id);
          if (!data) continue;
          const snapshot = { id, fetchedAt: current, data };
          snapshots.set(`bgg:${id}`, snapshot);
          await writeSnapshot(cachePath(options.dataDir, "bgg", id), snapshot);
        }
      } catch (error) {
        console.error(`  bgg metadata: ${(error as Error).message}`);
      }
    }
  }

  if (options.ludopediaToken) {
    for (const id of ludoMisses) {
      try {
        const snapshot = { id, fetchedAt: current, data: await fetchLudopedia(id, options.ludopediaToken, request) };
        snapshots.set(`ludopedia:${id}`, snapshot);
        await writeSnapshot(cachePath(options.dataDir, "ludopedia", id), snapshot);
      } catch (error) {
        console.error(`  ludopedia metadata ${id}: ${(error as Error).message}`);
      }
    }
  }

  for (const game of games) {
    const bgg = game.bggId ? snapshots.get(`bgg:${game.bggId}`) ?? stale.get(`bgg:${game.bggId}`) : undefined;
    const ludopedia = game.ludopediaId ? snapshots.get(`ludopedia:${game.ludopediaId}`) ?? stale.get(`ludopedia:${game.ludopediaId}`) : undefined;
    if (bgg || ludopedia) game.providerData = { bgg, ludopedia };
    game.facts = mergeFacts(bgg ? normalizeBgg(String(bgg.data)) : undefined, ludopedia ? normalizeLudopedia(ludopedia.data) : undefined);
  }
}
