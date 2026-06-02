#!/usr/bin/env bun
/**
 * Build-time cover sync. Detects games whose cover isn't cached (or can be
 * upgraded to a better source) and downloads it into the local cache. Idempotent:
 * re-runs only fetch what's missing or improvable. The running web app depends
 * solely on the resulting cache, never on a remote.
 *
 *   bun run covers            # sync using whatever creds are in the env
 *   task covers               # same, with .env injected from 1Password
 *
 * Credentials are optional: without them, games that already carry a
 * `ludopedia/id` still get full-res covers from the public bucket, and the rest
 * fall back to the BGG image. With LUDOPEDIA_ACCESS_TOKEN / LUDOPEDIA_COOKIE the
 * pipeline can also resolve missing ids (subject to Ludopedia's rate limit).
 */
import { loadGames, type Game } from "../games.ts";
import { buildCoverResolver, type GameRef, type SyncResult } from "../covers/index.ts";

const env = (k: string) => process.env[k] || undefined;
const INVENTORY_DIR = env("INVENTORY_DIR") ?? "../../../Yuri/Resources/Board Games/Inventory";
const COVERS_DIR = env("COVERS_DIR") ?? "./data";

const slugOf = (url?: string) => url?.match(/jogo\/([^/?#]+)/)?.[1]?.toLowerCase();

function toRef(g: Game): GameRef {
  return {
    id: g.id,
    name: g.name,
    bggId: g.bggId,
    bggImageUrl: g.image,
    ludopediaId: g.ludopediaId,
    ludopediaSlug: slugOf(g.urlLudopedia),
  };
}

const games = await loadGames(INVENTORY_DIR, { force: true });
const resolver = buildCoverResolver({
  coversDir: COVERS_DIR,
  ludopedia: { token: env("LUDOPEDIA_ACCESS_TOKEN"), cookie: env("LUDOPEDIA_COOKIE") },
});

console.log(`Syncing covers for ${games.length} games -> ${COVERS_DIR}`);
const tally: Record<string, number> = {};
await resolver.sync(games.map(toRef), (r: SyncResult) => {
  tally[r.outcome] = (tally[r.outcome] ?? 0) + 1;
  if (r.outcome === "fetched" || r.outcome === "upgraded")
    console.log(`  ${r.outcome.padEnd(8)} ${r.name}  <- ${r.source} (tier ${r.tier})`);
});

console.log("\nSummary:");
for (const [k, v] of Object.entries(tally).sort()) console.log(`  ${k.padEnd(9)} ${v}`);
const missing = tally.missing ?? 0;
const deferred = tally.deferred ?? 0;
if (deferred) console.log(`\n${deferred} deferred (source temporarily rate-limited) — re-run later to finish.`);
if (missing) console.log(`${missing} have no usable source.`);
