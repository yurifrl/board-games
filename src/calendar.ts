/**
 * Calendar domain layer. The Google Calendar is the source of truth:
 *   - an event with NO `game` extended property = an open availability block;
 *   - an event WITH `game`=<catalog id> + `players`=<csv emails> = a booked session.
 * Booking assigns a game into a block and sets the session time; join/leave edit
 * the players list. After any write we re-sync the local render cache (slots.json).
 */
import { listEvents, getEvent, patchEvent, gcalConfigured, type GCalEvent } from "./gcal.ts";
import { loadCatalog, writeSlots } from "./store.ts";
import type { Game } from "./games.ts";
import type { Slot } from "./slots.ts";

const WINDOW_DAYS = 60;

function mapEvent(e: GCalEvent, games: Game[]): Slot | null {
  const start = e.start?.dateTime ?? e.start?.date;
  const end = e.end?.dateTime ?? e.end?.date;
  if (!e.id || !start || !end) return null;
  const priv = e.extendedProperties?.private ?? {};
  const gameId = priv.game || undefined;
  const players = priv.players ? priv.players.split(",").filter(Boolean) : [];
  const game = gameId ? games.find((g) => g.id === gameId) : undefined;
  return {
    id: e.id,
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    location: e.location,
    gameId: game?.id,
    gameName: game?.name ?? (gameId ? e.summary : undefined),
    coverGameId: game?.id,
    coverSource: game ? (game.bggId ? "bgg" : game.ludopediaId ? "ludopedia" : undefined) : undefined,
    players,
    isBlock: !gameId,
  };
}

/** Pull the calendar into the local render cache. Returns the slots. */
export async function syncCalendar(dataDir: string): Promise<Slot[]> {
  if (!gcalConfigured()) {
    console.log("  calendar: skipped (GOOGLE_CALENDAR_ID / service account not set)");
    return [];
  }
  const now = new Date();
  const max = new Date(now.getTime() + WINDOW_DAYS * 86_400_000);
  const [events, games] = await Promise.all([
    listEvents(now.toISOString(), max.toISOString()),
    loadCatalog(dataDir),
  ]);
  const slots = events.map((e) => mapEvent(e, games)).filter((s): s is Slot => !!s);
  await writeSlots(dataDir, slots);
  return slots;
}

/** Book a game into an availability block: assign game, set the session time, seat the booker. */
export async function bookGame(
  eventId: string,
  game: { id: string; name: string },
  startIso: string,
  endIso: string,
  bookerEmail: string,
): Promise<void> {
  await patchEvent(eventId, {
    summary: `🎲 ${game.name}`,
    start: { dateTime: startIso },
    end: { dateTime: endIso },
    extendedProperties: { private: { game: game.id, players: bookerEmail.toLowerCase() } },
  });
}

async function editPlayers(eventId: string, mut: (players: Set<string>) => void): Promise<void> {
  const e = await getEvent(eventId);
  const priv = e.extendedProperties?.private ?? {};
  const players = new Set((priv.players ?? "").split(",").filter(Boolean));
  mut(players);
  await patchEvent(eventId, { extendedProperties: { private: { ...priv, players: [...players].join(",") } } });
}

export const joinSession = (eventId: string, email: string) =>
  editPlayers(eventId, (p) => p.add(email.toLowerCase()));
export const leaveSession = (eventId: string, email: string) =>
  editPlayers(eventId, (p) => p.delete(email.toLowerCase()));
