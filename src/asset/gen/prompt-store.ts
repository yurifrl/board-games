/**
 * Obsidian-backed prompt store. The global house style lives in the vault's
 * Inventory note frontmatter (`box-art/style`), editable live from the admin,
 * so tuning the look of every generated cover never needs a deploy. Reads fall
 * back to the built-in {@link BASE_STYLE} when the field is empty or Obsidian
 * isn't configured.
 */
import { BASE_STYLE } from "./box-art.ts";
import { getFrontmatter, setFrontmatter, findNotePath } from "../../worker/obsidian.ts";

const INVENTORY_NOTE =
  process.env.OBSIDIAN_INVENTORY_NOTE || "Yuri/Resources/Board Games/Inventory/Inventory.md";
const STYLE_FIELD = "box-art/style";
const ART_FIELD = "box-art/description";

export function obsidianEnabled(): boolean {
  return !!(process.env.OBSIDIAN_API_URL && process.env.OBSIDIAN_API_KEY);
}

/** Effective global house style: the Obsidian field, else BASE_STYLE. */
export async function loadGlobalStyle(): Promise<string> {
  if (!obsidianEnabled()) return BASE_STYLE;
  try {
    const fm = await getFrontmatter(INVENTORY_NOTE);
    const v = fm[STYLE_FIELD];
    return typeof v === "string" && v.trim() ? v.trim() : BASE_STYLE;
  } catch {
    return BASE_STYLE;
  }
}

/** The raw stored global style ("" when unset) — for prefilling the editor. */
export async function readGlobalStyleRaw(): Promise<string> {
  if (!obsidianEnabled()) return "";
  const fm = await getFrontmatter(INVENTORY_NOTE);
  const v = fm[STYLE_FIELD];
  return typeof v === "string" ? v : "";
}

/** Persist the global house style to the Inventory note. */
export async function saveGlobalStyle(text: string): Promise<void> {
  await setFrontmatter(INVENTORY_NOTE, STYLE_FIELD, text);
}

/** The built-in default, shown when the vault field is empty. */
export const DEFAULT_GLOBAL_STYLE = BASE_STYLE;

/** Read a game's per-game art note (`box-art/description`) live from its note. */
export async function readGameArtNote(id: string): Promise<string> {
  const path = await findNotePath(id);
  if (!path) return "";
  const fm = await getFrontmatter(path);
  const v = fm[ART_FIELD];
  return typeof v === "string" ? v : "";
}

/** Persist a game's per-game art note back to its Obsidian note. Returns false
 * when the note can't be located. */
export async function saveGameArtNote(id: string, text: string): Promise<boolean> {
  const path = await findNotePath(id);
  if (!path) return false;
  await setFrontmatter(path, ART_FIELD, text);
  return true;
}
