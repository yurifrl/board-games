/**
 * Isolated, manual box-art worker. Generates the flat-vector front + spine
 * faces for chosen games and stores them through the SAME asset service as the
 * regular sync — so when ASSETS_GCS_BUCKET is set this uploads to the private
 * GCS bucket, and otherwise writes the local disk cache. It is deliberately NOT
 * part of `bun run worker`: image generation is paid, so it only runs when you
 * invoke it.
 *
 *   bun run gen-box-art <game-id> [<game-id> ...]   # specific games
 *   bun run gen-box-art --all                       # every game in the catalog
 *   bun run gen-box-art --name "Root" "Azul"        # match by name prefix
 *
 * Fingerprints make it idempotent: a game already generated at the current
 * STYLE_VERSION is skipped (no repeat API cost) unless the prompt/style changes.
 */
import type { Game } from "../games.ts";
import { loadCatalog } from "../store.ts";
import { buildAssetPlatform } from "../asset/platform.ts";
import { runPipeline } from "../asset/pipeline.ts";
import { buildGenSources } from "../asset/gen/box-art.ts";
import type { Entity } from "../asset/types.ts";

const env = (k: string): string => process.env[k] ?? "";
const DATA_DIR = env("DATA_DIR") || "./data";

const toEntity = (g: Game): Entity => ({
  id: g.id,
  name: g.name,
  categories: g.facts?.categories,
  mechanics: g.facts?.mechanics,
  dims: g.siteSize,
});

function select(games: Game[], argv: string[]): Game[] {
  if (argv.includes("--all")) return games;
  const nameIdx = argv.indexOf("--name");
  if (nameIdx !== -1) {
    const needles = argv.slice(nameIdx + 1).map((s) => s.toLowerCase());
    return games.filter((g) => needles.some((n) => g.name.toLowerCase().startsWith(n)));
  }
  const ids = new Set(argv);
  return games.filter((g) => ids.has(g.id));
}

const apiKey = env("GEMINI_API_KEY");
if (!apiKey) {
  console.error("GEMINI_API_KEY is required");
  process.exit(1);
}

const games = await loadCatalog(DATA_DIR);
const chosen = select(games, process.argv.slice(2));
if (!chosen.length) {
  console.error("no games selected. usage: bun run gen-box-art <id ...> | --all | --name <prefix ...>");
  process.exit(1);
}

const { service } = buildAssetPlatform({ dataDir: DATA_DIR });
const target = env("ASSETS_GCS_BUCKET") ? `GCS bucket ${env("ASSETS_GCS_BUCKET")}` : `disk ${DATA_DIR}/assets`;
console.log(`generating box art for ${chosen.length} game(s) → ${target}`);

const sources = buildGenSources({ apiKey });
const tally: Record<string, number> = {};
await runPipeline(chosen.map(toEntity), sources, service, (r) => {
  tally[r.outcome] = (tally[r.outcome] ?? 0) + 1;
  const g = chosen.find((x) => x.id === r.entity);
  console.log(`  ${r.outcome.padEnd(9)} ${r.kind.padEnd(5)} ${g?.name ?? r.entity}`);
});
console.log(`done: ${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(" ")}`);
