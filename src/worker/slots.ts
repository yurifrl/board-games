/**
 * Slot sync: fetch the owner's game-slot calendar (a Google Calendar private ICS
 * URL) and turn each event into a Slot.
 *
 * Game resolution, in priority order:
 *   1. a `game:` key in the event description — matches a catalog game by slug,
 *      id, BGG id, Ludopedia id, or exact name (authoritative, no guessing);
 *   2. otherwise the event title, matched against catalog names (fuzzy).
 * Blank / "open" titles with no `game:` become open slots (game to be picked).
 * Seats come from a `seats:` key, else a [N]/(N) marker, else unknown. Not a
 * hard cap — extra players are accepted as a waitlist.
 *
 * ICS is read-only: this reflects the owner's agenda into the app; it does not
 * create calendar events. Write-back would need the Google Calendar OAuth API.
 */
import type { Game } from "../games.ts";
import type { Slot } from "../slots.ts";
import { parseIcs } from "./ics.ts";

/** Parse `key: value` lines from an event description (a `---` fence is ignored). */
function parseMeta(desc?: string): Record<string, string> {
  const meta: Record<string, string> = {};
  if (!desc) return meta;
  for (const line of desc.split("\n")) {
    const t = line.trim();
    if (!t || t === "---") continue;
    const i = t.indexOf(":");
    if (i === -1) continue;
    const k = t.slice(0, i).trim().toLowerCase();
    const v = t.slice(i + 1).trim();
    if (k && v) meta[k] = v;
  }
  return meta;
}

/** Extract a capacity marker like `[6]` or `(6)` from text, else null. */
function capacityFrom(...texts: (string | undefined)[]): number | null {
  for (const t of texts) {
    const m = t?.match(/[\[(](\d{1,3})[\])]/);
    if (m) return Number(m[1]);
  }
  return null;
}

/** Strip the capacity marker from a title to get the clean game name. */
const cleanTitle = (s: string): string => s.replace(/[\[(]\d{1,3}[\])]/g, "").trim();

/** Match a catalog game by an explicit id from the description (slug/id/bgg/ludo/name). */
function matchExplicit(ref: string, games: Game[]): Game | null {
  const r = ref.trim().toLowerCase();
  if (!r) return null;
  return (
    games.find((g) => g.slug?.toLowerCase() === r) ??
    games.find((g) => g.id.toLowerCase() === r) ??
    games.find((g) => g.bggId === r || g.ludopediaId === r) ??
    games.find((g) => g.name.toLowerCase() === r) ??
    null
  );
}

function resolveByTitle(title: string, games: Game[]): Game | null {
  const t = cleanTitle(title).toLowerCase();
  if (!t) return null;
  return (
    games.find((g) => g.name.toLowerCase() === t) ??
    games.find((g) => t.includes(g.name.toLowerCase()) || g.name.toLowerCase().includes(t)) ??
    null
  );
}

/** True when a title marks an explicitly-open slot (no game yet). */
const isOpenTitle = (title: string): boolean => {
  const t = cleanTitle(title).toLowerCase();
  return t === "" || t === "open" || t.startsWith("open ") || t.includes("game night") || t.includes("to be picked");
};

export async function fetchSlots(icsUrl: string, games: Game[]): Promise<Slot[]> {
  const res = await fetch(icsUrl);
  if (!res.ok) throw new Error(`fetch ICS: ${res.status}`);
  const events = parseIcs(await res.text());

  return events.map((e): Slot => {
    const meta = parseMeta(e.description);
    const explicit = meta.game ? matchExplicit(meta.game, games) : null;
    const open = !explicit && !meta.game && isOpenTitle(e.summary);
    const game = explicit ?? (open ? null : resolveByTitle(e.summary, games));
    const seats = meta.seats ? Number(meta.seats) : capacityFrom(e.summary, e.description);
    return {
      id: e.uid.replace(/[^0-9A-Za-z_-]/g, "").slice(0, 64) || Bun.hash(e.uid).toString(36),
      start: e.start,
      end: e.end,
      gameId: game?.id,
      gameName: game?.name ?? (open ? undefined : (meta.game ?? cleanTitle(e.summary)) || undefined),
      coverGameId: game?.id,
      coverSource: game ? (game.bggId ? "bgg" : game.ludopediaId ? "ludopedia" : undefined) : undefined,
      gameOpen: open,
      capacity: seats != null && Number.isFinite(seats) ? seats : undefined,
      location: e.location,
      notes: e.description,
    };
  });
}
