import type { Game } from "../games.ts";
import { palette as extractPalette } from "../asset/tint.ts";
import type { AssetService } from "../asset/service.ts";
import type { Entity } from "../asset/types.ts";

/** Shared helpers for the box-art workers (real generator + spine prompt test). */

export const coverSource = (g: Game): "bgg" | "ludopedia" | null =>
  g.bggId ? "bgg" : g.ludopediaId ? "ludopedia" : null;

/** BGG's own game blurb (from stored provider XML), cleaned to 1-2 sentences. */
export function bggBlurb(g: Game): string | undefined {
  const xml = g.providerData?.bgg?.data;
  const m = typeof xml === "string" ? xml.match(/<description>([\s\S]*?)<\/description>/) : null;
  if (!m) return undefined;
  const text = m[1]
    .replace(/&#10;|&#13;/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&rsquo;|&apos;/g, "'")
    .replace(/&mdash;/g, "\u2014").replace(/&ndash;/g, "\u2013")
    .replace(/&[a-z0-9#]+;/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  const sentences = text.match(/[^.!?]+[.!?]+/g)?.slice(0, 2).join(" ").trim();
  const short = sentences || text;
  return short.length > 240 ? short.slice(0, 240).replace(/\s+\S*$/, "") + "\u2026" : short;
}

/** Sample the game's real cover for a palette to theme its generated art. */
export async function coverPalette(g: Game, service: AssetService): Promise<string[]> {
  const source = coverSource(g);
  if (!source) return [];
  const cover = await service.render({ entity: g.id, kind: "cover", source, variant: "original", ext: "jpg" }, new URLSearchParams());
  return cover ? await extractPalette(cover) : [];
}

/** Pick games by `--all`, `--name <prefix ...>` (comma-splittable), or explicit ids. */
export function select(games: Game[], argv: string[]): Game[] {
  if (argv.includes("--all")) return games;
  const nameIdx = argv.indexOf("--name");
  if (nameIdx !== -1) {
    const needles = argv.slice(nameIdx + 1).flatMap((s) => s.split(",")).map((s) => s.trim().toLowerCase()).filter(Boolean);
    return games.filter((g) => needles.some((n) => g.name.toLowerCase().startsWith(n)));
  }
  const ids = new Set(argv);
  return games.filter((g) => ids.has(g.id));
}

/** Build the box-art {@link Entity} for a game (theme facts + cover palette). */
export async function toEntity(g: Game, service: AssetService): Promise<Entity> {
  return {
    id: g.id,
    name: g.name,
    categories: g.facts?.categories,
    mechanics: g.facts?.mechanics,
    description: g.description ?? bggBlurb(g),
    artNote: g.boxArtDescription,
    dims: g.dimensions,
    palette: await coverPalette(g, service),
  };
}
