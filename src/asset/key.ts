/**
 * The single source of truth for how an asset is addressed and laid out.
 * Nothing else in the codebase should build or parse these paths.
 *
 *   <entity>/<kind>/<source>/<variant>.<ext>
 *   23c7…/cover/bgg/original.jpg
 *   23c7…/cover/bgg/300x300.jpg      (a derivative, cache-only)
 *   23c7…/rulebook/hermes/base-game.pdf
 *
 * `kind`, `source`, `variant`, `ext` are open sets — new asset types and
 * sources add values, never new branches.
 */
export interface AssetKey {
  /** The game's Obsidian uuid (extensible to other entity types later). */
  entity: string;
  /** "cover" | "rulebook" | … */
  kind: string;
  /** "bgg" | "ludopedia" | "hermes" | … */
  source: string;
  /** "original" | "300x300" | a rulebook name | … */
  variant: string;
  /** file extension without the dot: "jpg" | "pdf" */
  ext: string;
}

const SAFE = /[^0-9A-Za-z._-]/g;
const clean = (s: string) => s.replace(SAFE, "");

/** Serialize a key to its object path. All segments are sanitized. */
export function keyPath(k: AssetKey): string {
  return `${clean(k.entity)}/${clean(k.kind)}/${clean(k.source)}/${clean(k.variant)}.${clean(k.ext)}`;
}

/** Parse an object path back into a key, or null if it isn't a valid asset path. */
export function parseKey(path: string): AssetKey | null {
  const m = path.match(/^([^/]+)\/([^/]+)\/([^/]+)\/(.+)\.([^.]+)$/);
  if (!m) return null;
  return { entity: m[1], kind: m[2], source: m[3], variant: m[4], ext: m[5] };
}

/** The GCS prefix for listing a subset, e.g. all of one game's rulebooks. */
export function keyPrefix(p: { entity: string; kind?: string; source?: string }): string {
  let out = clean(p.entity);
  if (p.kind) out += `/${clean(p.kind)}`;
  if (p.source) out += `/${clean(p.source)}`;
  return out + "/";
}

/** A key for a derivative variant of an original (e.g. a resized cover). */
export const variantKey = (original: AssetKey, variant: string): AssetKey => ({ ...original, variant });
