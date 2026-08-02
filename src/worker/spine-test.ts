/**
 * Local spine-prompt test. Regenerates ONLY the spine face for a set of games
 * using the current prompt, WITHOUT uploading: originals are read disk-first and
 * fall back to the GCS bucket (read-only via NoWriteStore) when ASSETS_GCS_BUCKET
 * is set, and generated art is written to the local disk cache only. Then it
 * loads the running /spine page in headless Chrome and saves a timestamped
 * screenshot under .agents/tmp/spine-tests/ (+ spine-latest.png) so progress is
 * visible across iterations.
 *
 *   bun run src/worker/spine-test.ts                       # the default 6 games
 *   bun run src/worker/spine-test.ts "root" "azul"         # by name prefix
 */
import { spawnSync } from "node:child_process";
import { mkdir, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { loadCatalog } from "../store.ts";
import { AssetService } from "../asset/service.ts";
import { DiskBlobStore } from "../asset/store/disk.ts";
import { GcsBlobStore } from "../asset/store/gcs.ts";
import { NoWriteStore } from "../asset/store/nowrite.ts";
import { buildRenderers } from "../asset/render/registry.ts";
import { runPipeline } from "../asset/pipeline.ts";
import { buildGenSources } from "../asset/gen/box-art.ts";
import { select, toEntity } from "./box-art-lib.ts";

const env = (k: string): string => process.env[k] ?? "";
const DATA_DIR = env("DATA_DIR") || "./data";
const SPINE_URL = env("SPINE_URL") || "http://localhost:3000/spine";
const CHROME = env("CHROME_BIN") || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEFAULT_NAMES = ["spook", "hot", "diatoms", "magical", "barbecubes", "o gato e a torre"];

const apiKey = env("OPENAI_API_KEY");
if (!apiKey) {
  console.error("OPENAI_API_KEY is required");
  process.exit(1);
}

// Reads: disk first, then (read-only) bucket. Writes: disk cache only — never uploads.
const cache = new DiskBlobStore(join(DATA_DIR, "assets"));
const origin = env("ASSETS_GCS_BUCKET") ? new NoWriteStore(new GcsBlobStore()) : cache;
const service = new AssetService(origin, cache, buildRenderers(), false);

const games = await loadCatalog(DATA_DIR);
const argv = process.argv.slice(2);
const chosen = select(games, ["--name", ...(argv.length ? argv : DEFAULT_NAMES)]);
if (!chosen.length) {
  console.error("no games matched");
  process.exit(1);
}
console.log(`spine prompt test (no upload) → ${chosen.map((g) => g.name).join(", ")}`);

const entities = await Promise.all(chosen.map((g) => toEntity(g, service)));
const spineSources = buildGenSources({ apiKey }).filter((s) => s.kind === "spine");
await runPipeline(
  entities,
  spineSources,
  service,
  (r) => console.log(`  ${r.outcome.padEnd(8)} ${r.kind} ${chosen.find((x) => x.id === r.entity)?.name ?? r.entity}`),
  { force: true, concurrency: Math.min(5, chosen.length) },
);

// Load and print the actual rendered page.
const outDir = ".agents/tmp/spine-tests";
await mkdir(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = join(outDir, `${stamp}.png`);
const res = spawnSync(CHROME, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars",
  "--force-device-scale-factor=2", "--window-size=1600,2400",
  "--virtual-time-budget=4000", `--screenshot=${out}`, SPINE_URL,
], { stdio: "inherit" });
if (res.status !== 0) {
  console.error(`\nchrome screenshot failed (is the dev server up at ${SPINE_URL}?)`);
  process.exit(1);
}
await copyFile(out, ".agents/tmp/spine-latest.png");
console.log(`\nprinted ${SPINE_URL}\n  ${out}\n  .agents/tmp/spine-latest.png`);
