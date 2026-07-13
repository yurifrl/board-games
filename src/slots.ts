import { loadSlots } from "./store.ts";
import { signupCounts } from "./signups.ts";

/**
 * A game slot on the owner's agenda, synced from the calendar by the worker.
 * `gameOpen` marks a slot where the game is still to be picked.
 */
export type Slot = {
  id: string;
  start: string; // ISO
  end: string; // ISO
  gameId?: string;
  gameName?: string;
  coverGameId?: string; // catalog game id to render a cover for (= gameId when resolved)
  coverSource?: "bgg" | "ludopedia"; // which asset source has the cover
  gameOpen: boolean;
  /** Seats in the game (its max players) when known. Not a hard cap — extra
   * players are accepted as a waitlist. Undefined = unknown. */
  capacity?: number;
  location?: string;
  notes?: string;
};

export type SlotView = Slot & { taken: number; over: boolean };

/** Upcoming slots (end in the future), soonest first, with live signup counts. */
export async function loadUpcomingSlots(dataDir: string): Promise<SlotView[]> {
  const [slots, counts] = await Promise.all([loadSlots(dataDir), signupCounts(dataDir)]);
  const now = Date.now();
  return slots
    .filter((s) => Date.parse(s.end) >= now)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .map((s) => {
      const taken = counts.get(s.id) ?? 0;
      return { ...s, taken, over: s.capacity != null && taken > s.capacity };
    });
}

export async function getSlotView(dataDir: string, id: string): Promise<SlotView | null> {
  const [slots, counts] = await Promise.all([loadSlots(dataDir), signupCounts(dataDir)]);
  const s = slots.find((x) => x.id === id);
  if (!s) return null;
  const taken = counts.get(s.id) ?? 0;
  return { ...s, taken, over: s.capacity != null && taken > s.capacity };
}
