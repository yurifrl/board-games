import { loadSlots } from "./store.ts";

/**
 * A slot is a calendar event, synced by the calendar layer (src/calendar.ts).
 * `isBlock` = an open availability block (no game yet); otherwise it's a booked
 * session with a game + players. The calendar is the source of truth; this reads
 * the local cache the sync writes.
 */
export type Slot = {
  id: string; // calendar event id
  start: string;
  end: string;
  location?: string;
  gameId?: string;
  gameName?: string;
  coverGameId?: string;
  coverSource?: "bgg" | "ludopedia";
  players: string[]; // member emails seated in this session
  isBlock: boolean;
};

export type SlotView = Slot & { taken: number };

async function upcoming(dataDir: string): Promise<SlotView[]> {
  const slots = await loadSlots(dataDir);
  const now = Date.now();
  return slots
    .filter((s) => Date.parse(s.end) >= now)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .map((s) => ({ ...s, taken: s.players.length }));
}

/** Booked sessions (game assigned), soonest first. */
export const upcomingSessions = async (dataDir: string): Promise<SlotView[]> =>
  (await upcoming(dataDir)).filter((s) => !s.isBlock);

/** Open availability blocks the owner set up, soonest first. */
export const openBlocks = async (dataDir: string): Promise<SlotView[]> =>
  (await upcoming(dataDir)).filter((s) => s.isBlock);

export async function getSlotView(dataDir: string, id: string): Promise<SlotView | null> {
  const slots = await loadSlots(dataDir);
  const s = slots.find((x) => x.id === id);
  return s ? { ...s, taken: s.players.length } : null;
}
