/**
 * Isolated, manual box-art worker. Generates the flat-vector front + spine
 * faces for chosen games and stores them through the SAME asset service as the
 * regular sync — so when ASSETS_GCS_BUCKET is set this uploads to the private
 * GCS bucket (and also mirrors a copy to the local disk cache), and otherwise
 * writes the local disk cache only. It is deliberately NOT part of
 * `bun run worker`: image generation is paid, so it only runs when you invoke it.
 *
 *   bun run gen-box-art <game-id> [<game-id> ...]   # specific games
 *   bun run gen-box-art --all                       # every game in the catalog
 *   bun run gen-box-art --name "Root" "Azul"        # match by name prefix
 *
 * Every run REGENERATES and overwrites: generation is non-deterministic, so
 * re-running always pulls fresh art. Each game's art is themed from its REAL
 * cover — the cover's dominant palette is sampled and fed into the prompt. It
 * prints a URL for every generated face.
 */
import { Storage } from "@google-cloud/storage";
import type { Game } from "../games.ts";
import { loadCatalog } from "../store.ts";
import { buildAssetPlatform } from "../asset/platform.ts";
import { runPipeline } from "../asset/pipeline.ts";
import { buildGenSources } from "../asset/gen/box-art.ts";
import { boxArtKey, FACES } from "../asset/box-contract.ts";
import { keyPath } from "../asset/key.ts";
import { select, toEntity } from "./box-art-lib.ts";

const env = (k: string): string => process.env[k] ?? "";
const DATA_DIR = env("DATA_DIR") || "./data";
const BUCKET = env("ASSETS_GCS_BUCKET");

const bucket = BUCKET ? new Storage().bucket(BUCKET) : null;
/** A URL to view a stored face — a 7-day signed URL on GCS, else the disk path. */
async function urlFor(id: string, face: (typeof FACES)[number]): Promise<string> {
  const path = keyPath(boxArtKey(id, face));
  if (!bucket) return `${DATA_DIR}/assets/${path}`;
  const [url] = await bucket.file(path).getSignedUrl({ version: "v4", action: "read", expires: Date.now() + 7 * 24 * 3600 * 1000 });
  return url;
}

const apiKey = env("OPENAI_API_KEY");
if (!apiKey) {
  console.error("OPENAI_API_KEY is required");
  process.exit(1);
}

const games = await loadCatalog(DATA_DIR);
const chosen = select(games, process.argv.slice(2));
if (!chosen.length) {
  console.error("no games selected. usage: bun run gen-box-art <id ...> | --all | --name <prefix ...>");
  process.exit(1);
}

const { service } = buildAssetPlatform({ dataDir: DATA_DIR });
console.log(`generating box art for ${chosen.length} game(s) → ${BUCKET ? `GCS bucket ${BUCKET}` : `disk ${DATA_DIR}/assets`}`);

const entities = await Promise.all(chosen.map((g) => toEntity(g, service)));

const sources = buildGenSources({ apiKey });
const tally: Record<string, number> = {};
const touched = new Set<string>();
await runPipeline(entities, sources, service, (r) => {
  tally[r.outcome] = (tally[r.outcome] ?? 0) + 1;
  const name = chosen.find((x) => x.id === r.entity)?.name ?? r.entity;
  console.log(`  ${r.outcome.padEnd(9)} ${r.kind.padEnd(5)} ${name}`);
  if (r.outcome === "stored" || r.outcome === "unchanged") touched.add(r.entity);
}, { force: true, concurrency: chosen.length > 1 ? 5 : 1 });

console.log("\nURLs:");
for (const id of touched) {
  const name = chosen.find((x) => x.id === id)?.name ?? id;
  for (const face of FACES) console.log(`  ${name} ${face}: ${await urlFor(id, face)}`);
}
console.log(`\ndone: ${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(" ")}`);
