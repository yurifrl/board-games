/**
 * Worker sidecar. Polls the Obsidian Local REST API and syncs everything the app
 * needs into a single volume: the game catalog, the users file, and covers.
 *
 *   bun run src/worker/index.ts           # long-running (polls every N ms)
 *   SYNC_ONCE=1 bun run src/worker/index.ts   # one cycle, then exit
 *
 * The app reads only from the volume; it never talks to Obsidian directly.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadGames, type Game } from "../games.ts";
import { coverKeyCandidates } from "../covers/keys.ts";
import { buildCoverResolver } from "../covers/index.ts";
import type { GameRef } from "../covers/types.ts";
import { GcsStore } from "../assets/gcs.ts";
import { uploadOriginals } from "../assets/fill.ts";
import { defaultObsidianConfig, listNotes, getNote } from "./obsidian.ts";
import { parseGameNote, parseUsersNote } from "./parse.ts";
import { writeCatalog, writeUsers, storePaths, type UsersFile } from "../store.ts";

const env = (k: string, d?: string): string => process.env[k] ?? d ?? "";

const OBSIDIAN_INVENTORY_FOLDER = env("OBSIDIAN_INVENTORY_FOLDER", "Yuri/Resources/Board Games/Inventory");
const OBSIDIAN_USERS_NOTE = env("OBSIDIAN_USERS_NOTE", "Yuri/Resources/Board Games/Users.md");
const DATA_DIR = env("DATA_DIR", "./data");
const SYNC_INTERVAL_MS = Number(env("SYNC_INTERVAL_MS", "300000"));
const SYNC_ONCE = env("SYNC_ONCE") === "1";

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

async function syncCatalog(): Promise<Game[]> {
  const cfg = defaultObsidianConfig();
  const files = await listNotes(OBSIDIAN_INVENTORY_FOLDER, cfg);
  const games: Game[] = [];
  for (const name of files) {
    try {
      const raw = await getNote(`${OBSIDIAN_INVENTORY_FOLDER}/${name}`, cfg);
      const g = parseGameNote(raw);
      if (g) {
        const coverKey = coverKeyCandidates(g).find((k) => existsSync(join(storePaths(DATA_DIR).covers, k, "cover.jpg")));
        g.coverKey = coverKey;
        g.hasCover = !!coverKey;
        games.push(g);
      }
    } catch (e) {
      console.error(`  skip ${name}: ${(e as Error).message}`);
    }
  }
  games.sort((a, b) => a.name.localeCompare(b.name));
  await writeCatalog(DATA_DIR, games);
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

async function syncCovers(games: Game[]): Promise<void> {
  const resolver = buildCoverResolver({
    coversDir: storePaths(DATA_DIR).covers,
    ludopedia: {
      token: env("LUDOPEDIA_ACCESS_TOKEN"),
      cookie: env("LUDOPEDIA_COOKIE"),
    },
  });
  const tally: Record<string, number> = {};
  await resolver.sync(games.map(toRef), (r) => {
    tally[r.outcome] = (tally[r.outcome] ?? 0) + 1;
    if (r.outcome === "fetched" || r.outcome === "upgraded")
      console.log(`  ${r.outcome.padEnd(8)} ${r.name} <- ${r.source}`);
  });
  const summary = Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(" ");
  console.log(`  covers: ${summary}`);
  await uploadCovers(games);
}

async function uploadCovers(games: Game[]): Promise<void> {
  if (!process.env.ASSETS_GCS_BUCKET) return; // GCS not configured (e.g. local dev)
  const n = await uploadOriginals(games, storePaths(DATA_DIR).covers, new GcsStore());
  console.log(`  gcs: uploaded=${n}`);
}

async function cycle(): Promise<void> {
  console.log(`[${new Date().toISOString()}] sync start`);
  try {
    const games = await syncCatalog();
    console.log(`  catalog: ${games.length} games`);
    await syncUsers();
    console.log(`  users: synced`);
    await syncCovers(games);
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
