/**
 * Slot sync: fetch the owner's game-slot calendar (a Google Calendar private ICS
 * URL) and turn each event into a Slot. The game is resolved from the event
 * title against the catalog; unmatched or blank titles become "open" slots
 * (game to be picked). Capacity comes from a [N] or (N) marker, default 4.
 *
 * ICS is read-only: this reflects the owner's agenda into the app; it does not
 * create calendar events. Write-back would need the Google Calendar OAuth API.
 */
import type { Game } from "../games.ts";
import type { Slot } from "../slots.ts";
import { parseIcs } from "./ics.ts";

const DEFAULT_CAPACITY = Number(process.env.SLOT_DEFAULT_CAPACITY ?? "4");

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

function resolveGame(title: string, games: Game[]): Game | null {
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
    const cap = capacityFrom(e.summary, e.description) ?? DEFAULT_CAPACITY;
    const open = isOpenTitle(e.summary);
    const game = open ? null : resolveGame(e.summary, games);
    return {
      id: e.uid.replace(/[^0-9A-Za-z_-]/g, "").slice(0, 64) || Bun.hash(e.uid).toString(36),
      start: e.start,
      end: e.end,
      gameId: game?.id,
      gameName: game?.name ?? (open ? undefined : cleanTitle(e.summary) || undefined),
      coverGameId: game?.id,
      coverSource: game ? (game.bggId ? "bgg" : game.ludopediaId ? "ludopedia" : undefined) : undefined,
      gameOpen: open,
      capacity: cap,
      location: e.location,
      notes: e.description,
    };
  });
}
