/**
 * Obsidian note parsing. Moved here from games.ts — only the worker parses
 * markdown now; the app reads the flattened catalog from the volume.
 */
import { parse as parseYaml } from "yaml";
import type { Game } from "../games.ts";

const NON_GAME_TAGS = new Set(["book", "skip", "tcg"]);

/** Parse `DD/MM/YY` (with `??` allowed) to epoch ms, or null. */
function parsePurchaseDate(s?: string): number | null {
  if (!s) return null;
  const m = s.match(/^(\d{1,2}|\?\?)\/(\d{1,2}|\?\?)\/(\d{2,4})$/);
  if (!m) return null;
  const day = m[1] === "??" ? 1 : Number(m[1]);
  const mon = m[2] === "??" ? 1 : Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  const t = Date.UTC(year, mon - 1, day);
  return Number.isNaN(t) ? null : t;
}

function str(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim() !== "") return v;
  return undefined;
}

/** Parse a note's markdown frontmatter + body into a Game, or null. */
export function parseGameNote(raw: string): Game | null {
  const { fm, body } = parseFrontmatter(raw);
  return mapGame(fm, body);
}

/**
 * Minimal YAML frontmatter parser tailored to the Obsidian board-game notes.
 * Handles: `key: "quoted"`, `key: bare`, `key: []`, `key: ["a","b"]`, `key: true`.
 * Keys can contain slashes (e.g. `purchase/date`, `image/grid`).
 */
export function parseFrontmatter(raw: string): { fm: Record<string, unknown>; body: string } {
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

function mapGame(fm: Record<string, unknown>, body: string): Game | null {
  const id = str(fm["id"]);
  const name = str(fm["name"]);
  if (!id || !name) return null;

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
    isGame: !tags.some((t) => NON_GAME_TAGS.has(String(t).toLowerCase())),
    purchasedAt: parsePurchaseDate(str(fm["purchase/date"])),
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

/** Parse only the YAML frontmatter block (between `---` fences) with a real parser. */
function frontmatterBlock(raw: string): string {
  if (!raw.startsWith("---")) return "";
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return "";
  return raw.slice(3, end).trim();
}

/** Parse a Users.md note with real YAML (nested roles + users list). */
export function parseUsersNote(raw: string): {
  defaultRole: string;
  roles: Record<string, Record<string, boolean>>;
  users: { identifier: string; password: string; role: string }[];
} {
  const fm = (parseYaml(frontmatterBlock(raw)) ?? {}) as Record<string, unknown>;
  const roles = (fm["roles"] ?? {}) as Record<string, Record<string, boolean>>;
  const defaultRole = String(fm["defaultRole"] ?? "viewer");

  const users: { identifier: string; password: string; role: string }[] = [];
  const rawUsers = fm["users"];
  if (Array.isArray(rawUsers)) {
    for (const u of rawUsers) {
      if (typeof u !== "object" || u === null) continue;
      const obj = u as Record<string, unknown>;
      const identifier = str(obj["identifier"]);
      const password = str(obj["password"]);
      const role = str(obj["role"]) ?? defaultRole;
      if (identifier && password) users.push({ identifier: identifier.toLowerCase(), password, role });
    }
  }
  return { defaultRole, roles, users };
}
