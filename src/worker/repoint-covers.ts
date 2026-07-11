/**
 * One-off maintenance: point every Inventory note's `image/grid` frontmatter at
 * this app's asset endpoint (a signed, size-parameterized cover URL) instead of
 * a provider thumbnail.
 *
 *   bun run repoint-covers                 # apply to all notes
 *   DRY_RUN=1 bun run repoint-covers       # print what would change, write nothing
 *   LIMIT=1 DRY_RUN=1 bun run repoint-covers
 *
 * The URL is `<BASE_URL>/asset/<id>/cover/<source>/original.jpg?w=<W>&sig=…`,
 * signed with the same secret the app verifies (stable, no expiry).
 */
import { sign } from "../asset/auth.ts";
import { defaultObsidianConfig, listNotes, getNote, setFrontmatter } from "./obsidian.ts";
import { parseGameNote } from "./parse.ts";

const env = (k: string, d?: string): string => process.env[k] ?? d ?? "";

const FOLDER = env("OBSIDIAN_INVENTORY_FOLDER", "Yuri/Resources/Board Games/Inventory");
const BASE_URL = env("BASE_URL", "https://bg.syscd.live").replace(/\/$/, "");
const GRID_WIDTH = Number(env("GRID_WIDTH", "400"));
const DRY_RUN = env("DRY_RUN") === "1";
const LIMIT = Number(env("LIMIT", "0"));

function coverUrl(id: string, source: "bgg" | "ludopedia"): string {
  const key = { entity: id, kind: "cover", source, variant: "original", ext: "jpg" };
  return `${BASE_URL}/asset/${id}/cover/${source}/original.jpg?${sign(key, { w: GRID_WIDTH })}`;
}

async function main() {
  const cfg = defaultObsidianConfig();
  const files = await listNotes(FOLDER, cfg);
  const tally = { updated: 0, skipped: 0, failed: 0 };

  for (const name of LIMIT ? files.slice(0, LIMIT) : files) {
    const path = `${FOLDER}/${name}`;
    try {
      const g = parseGameNote(await getNote(path, cfg));
      const source = g?.bggId ? "bgg" : g?.ludopediaId ? "ludopedia" : null;
      if (!g || !source) {
        tally.skipped++;
        continue;
      }
      const url = coverUrl(g.id, source);
      if (DRY_RUN) console.log(`would set ${name} image/grid -> ${url}`);
      else {
        await setFrontmatter(path, "image/grid", url, cfg);
        console.log(`updated ${name}`);
      }
      tally.updated++;
    } catch (e) {
      tally.failed++;
      console.error(`  fail ${name}: ${(e as Error).message}`);
    }
  }
  console.log(`\n${DRY_RUN ? "[dry-run] " : ""}updated=${tally.updated} skipped=${tally.skipped} failed=${tally.failed}`);
}

await main();
