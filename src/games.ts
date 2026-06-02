import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { coverKeyCandidates } from "./covers/keys.ts";

const COVERS_DIR = process.env.COVERS_DIR ?? "./data";

export type Game = {
  id: string;
  name: string;
  language?: string;
  type?: string;
  expansionOf?: string;
  price?: string;
  purchaseSource?: string;
  purchaseDate?: string;
  tags: string[];
  urlBgg?: string;
  urlLudopedia?: string;
  bggId?: string;
  ludopediaId?: string;
  image?: string;
  hasCover?: boolean;
  /** Source-keyed cache dir to serve the cover from, e.g. `ludopedia-15950`. */
  coverKey?: string;
  forSale: boolean;
  salePrice?: string;
  notes?: string;
};

/**
 * Minimal YAML frontmatter parser tailored to the Obsidian board-game notes.
 * Handles: `key: "quoted"`, `key: bare`, `key: []`, `key: ["a","b"]`, `key: true`.
 * Keys can contain slashes (e.g. `purchase/date`, `image/grid`).
 */
function parseFrontmatter(raw: string): { fm: Record<string, unknown>; body: string } {
  if (!raw.startsWith("---")) return { fm: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { fm: {}, body: raw };
  const block = raw.slice(3, end).trim();
  const body = raw.slice(raw.indexOf("\n", end + 1) + 1).trim();

  const fm: Record<string, unknown> = {};
  for (const line of block.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (!key) continue;

    if (val.startsWith("[") && val.endsWith("]")) {
      const inner = val.slice(1, -1).trim();
      fm[key] = inner
        ? inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""))
        : [];
      continue;
    }
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (val === "true") fm[key] = true;
    else if (val === "false") fm[key] = false;
    else fm[key] = val;
  }
  return { fm, body };
}

function str(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim() !== "") return v;
  return undefined;
}

function mapGame(fm: Record<string, unknown>, body: string): Game | null {
  const id = str(fm["id"]);
  const name = str(fm["name"]);
  if (!id || !name) return null; // not an inventory item

  const tags = Array.isArray(fm["tags"]) ? (fm["tags"] as string[]) : [];

  return {
    id,
    name,
    language: str(fm["language"]),
    type: str(fm["type"]),
    expansionOf: str(fm["expansion-of"]),
    price: str(fm["price"]),
    purchaseSource: str(fm["purchase/source"]),
    purchaseDate: str(fm["purchase/date"]),
    tags,
    urlBgg: str(fm["bgg/url"]) ?? str(fm["url/bgg"]),
    urlLudopedia: str(fm["ludopedia/url"]) ?? str(fm["url/ludopedia"]),
    bggId: str(fm["bgg/id"]),
    ludopediaId: str(fm["ludopedia/id"]),
    image: str(fm["image/grid"]),
    forSale: fm["for_sale"] === true || fm["for-sale"] === true,
    salePrice: str(fm["sale_price"]) ?? str(fm["sale-price"]),
    notes: body || undefined,
  };
}

let cache: { at: number; games: Game[] } | null = null;
const TTL_MS = 60_000;

export async function loadGames(dir: string, opts: { force?: boolean } = {}): Promise<Game[]> {
  if (!opts.force && cache && Date.now() - cache.at < TTL_MS) return cache.games;

  const entries = await readdir(dir);
  const games: Game[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const full = join(dir, entry);
    try {
      const s = await stat(full);
      if (!s.isFile()) continue;
      const raw = await readFile(full, "utf8");
      const { fm, body } = parseFrontmatter(raw);
      const g = mapGame(fm, body);
      if (g) {
        // Serve from the best available source-keyed cover (Ludopedia over BGG).
        g.coverKey = coverKeyCandidates(g).find((k) => existsSync(join(COVERS_DIR, k, "cover.jpg")));
        g.hasCover = !!g.coverKey;
        games.push(g);
      }
    } catch {
      // skip unreadable files
    }
  }
  games.sort((a, b) => a.name.localeCompare(b.name));
  cache = { at: Date.now(), games };
  return games;
}

export type GameGroup = { base: Game; expansions: Game[] };

/**
 * Group expansions under their base game. An expansion (`type === "expansion"`)
 * is matched to a base whose `name` equals its `expansion-of` (case-insensitive).
 * Expansions whose base game isn't in the collection are surfaced as their own
 * top-level entry so nothing is hidden.
 */
export function groupGames(games: Game[]): GameGroup[] {
  const isExpansion = (g: Game) => g.type === "expansion" && !!g.expansionOf;
  const baseByName = new Map<string, Game>();
  for (const g of games) {
    if (!isExpansion(g)) baseByName.set(g.name.toLowerCase(), g);
  }

  const groups = new Map<string, GameGroup>();
  const orderedTopLevel: Game[] = [];

  // Seed top-level entries (bases + standalone games) in sorted order.
  for (const g of games) {
    if (isExpansion(g)) continue;
    groups.set(g.id, { base: g, expansions: [] });
    orderedTopLevel.push(g);
  }

  // Attach expansions; orphans become their own top-level entry.
  for (const g of games) {
    if (!isExpansion(g)) continue;
    const base = baseByName.get(g.expansionOf!.toLowerCase());
    if (base) {
      groups.get(base.id)!.expansions.push(g);
    } else {
      groups.set(g.id, { base: g, expansions: [] });
      orderedTopLevel.push(g);
    }
  }

  orderedTopLevel.sort((a, b) => a.name.localeCompare(b.name));
  const result = orderedTopLevel.map((g) => groups.get(g.id)!);
  for (const grp of result) {
    grp.expansions.sort((a, b) => a.name.localeCompare(b.name));
  }
  return result;
}
