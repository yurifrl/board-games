/**
 * Worker sidecar. Polls the Obsidian Local REST API and syncs everything the app
 * needs into a single volume: the game catalog, the users file, and covers.
 *
 *   bun run src/worker/index.ts           # long-running (polls every N ms)
 *   SYNC_ONCE=1 bun run src/worker/index.ts   # one cycle, then exit
 *
 * The app reads only from the volume; it never talks to Obsidian directly.
 */
import { type Game } from "../games.ts";
import { buildAssetPlatform } from "../asset/platform.ts";
import { runPipeline } from "../asset/pipeline.ts";
import { dominantColor } from "../asset/tint.ts";
import type { AssetService } from "../asset/service.ts";
import type { Entity } from "../asset/types.ts";
import { defaultObsidianConfig, listNotes, getNote } from "./obsidian.ts";
import { parseGameNote, parseUsersNote } from "./parse.ts";
import { writeCatalog, writeUsers, type UsersFile } from "../store.ts";

const env = (k: string, d?: string): string => process.env[k] ?? d ?? "";

const OBSIDIAN_INVENTORY_FOLDER = env("OBSIDIAN_INVENTORY_FOLDER", "Yuri/Resources/Board Games/Inventory");
const OBSIDIAN_USERS_NOTE = env("OBSIDIAN_USERS_NOTE", "Yuri/Resources/Board Games/Users.md");
const DATA_DIR = env("DATA_DIR", "./data");
const SYNC_INTERVAL_MS = Number(env("SYNC_INTERVAL_MS", "300000"));
const SYNC_ONCE = env("SYNC_ONCE") === "1";

const slugOf = (url?: string) => url?.match(/jogo\/([^/?#]+)/)?.[1]?.toLowerCase();

function toEntity(g: Game): Entity {
  return {
    id: g.id,
    name: g.name,
    bggId: g.bggId,
    bggImageUrl: g.image,
    ludopediaId: g.ludopediaId,
    ludopediaSlug: slugOf(g.urlLudopedia),
  };
}

async function syncCatalog(): Promise<Game[]> {
  const cfg = defaultObsidianConfig();
  const files = await listNotes(OBSIDIAN_INVENTORY_FOLDER, cfg);
  const games: Game[] = [];
  for (const name of files) {
    try {
      const raw = await getNote(`${OBSIDIAN_INVENTORY_FOLDER}/${name}`, cfg);
      const g = parseGameNote(raw);
      if (g) games.push(g);
    } catch (e) {
      console.error(`  skip ${name}: ${(e as Error).message}`);
    }
  }
  games.sort((a, b) => a.name.localeCompare(b.name));
  return games;
}

async function syncUsers(): Promise<void> {
  const cfg = defaultObsidianConfig();
  const raw = await getNote(OBSIDIAN_USERS_NOTE, cfg);
  const parsed = parseUsersNote(raw);
  const data: UsersFile = {
    defaultRole: parsed.defaultRole,
    roles: parsed.roles,
    users: parsed.users,
  };
  await writeUsers(DATA_DIR, data);
}

async function syncAssets(games: Game[], service: AssetService, sources: import("../asset/types.ts").AssetSource[]): Promise<void> {
  const tally: Record<string, number> = {};
  await runPipeline(games.map(toEntity), sources, service, (r) => {
    tally[r.outcome] = (tally[r.outcome] ?? 0) + 1;
    if (r.outcome === "stored") console.log(`  stored   ${r.entity} <- ${r.source}/${r.kind}`);
  });
  console.log(`  assets: ${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(" ")}`);
}

/** Enrich each game with its cover's dominant color, read from the stored cover. */
async function enrichTint(games: Game[], service: AssetService): Promise<void> {
  for (const g of games) {
    const source = g.bggId ? "bgg" : g.ludopediaId ? "ludopedia" : null;
    if (!source) continue;
    const blob = await service.render({ entity: g.id, kind: "cover", source, variant: "original", ext: "jpg" }, new URLSearchParams());
    if (blob) g.tint = (await dominantColor(blob)) ?? undefined;
  }
}

async function cycle(): Promise<void> {
  console.log(`[${new Date().toISOString()}] sync start`);
  try {
    const { service, sources } = buildAssetPlatform({
      dataDir: DATA_DIR,
      ludopedia: { token: env("LUDOPEDIA_ACCESS_TOKEN"), cookie: env("LUDOPEDIA_COOKIE") },
    });
    const games = await syncCatalog();
    console.log(`  catalog: ${games.length} games`);
    await syncUsers();
    console.log(`  users: synced`);
    await syncAssets(games, service, sources);
    await enrichTint(games, service);
    await writeCatalog(DATA_DIR, games);
  } catch (e) {
    console.error(`sync failed: ${(e as Error).message}`);
  }
  console.log(`[${new Date().toISOString()}] sync done`);
}

if (SYNC_ONCE) {
  await cycle();
} else {
  await cycle();
  setInterval(cycle, SYNC_INTERVAL_MS);
  console.log(`worker polling every ${SYNC_INTERVAL_MS}ms (DATA_DIR=${DATA_DIR})`);
}
