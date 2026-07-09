# Plan — "I want to play": self-hosted Calendly for game nights

Epic: **board-games-mqs**. Built on the existing **worker → volume → SSR** architecture.
The worker syncs the owner's game slots from a calendar into the volume; the app
reads slots and writes runtime signups/requests; no client-side fetching.

## How it works (user's words → system)

- *"People say I want to play and see my agenda's game slots"* → public `/play`
  schedule rendered from `slots.json` (synced from the calendar).
- *"Syncs with my agenda like Calendly"* → worker fetches the owner's calendar and
  writes `slots.json`. Owner edits the calendar; slots appear here.
- *"Games appear in the calendar they see + how many people already in"* → each slot
  shows its game (or *open*) and `X of N in` (capacity − signups).
- *"I can share slots of games to be picked and games already picked"* → shareable
  `/slot/:id` links; open slots (game TBD) and picked slots both share cleanly.
- *"People login with phones, put their WhatsApp, I approve, they get a pass link + key"*
  → phone/WhatsApp access request → owner approves → magic pass link → phone session.

## Data model (single volume, `DATA_DIR`)

| File | Writer | Shape |
|------|--------|-------|
| `slots.json` | worker | `[{id, start, end, game?{id,name,coverKey}, gameOpen, capacity, location?, notes?}]` |
| `signups.jsonl` | app | `{slotId, phone, name?, gamePref?, createdAt, deleted?}` (last-wins, tombstones) |
| `access-requests.jsonl` | app | `{phone, name?, message?, createdAt, status}` (last-wins) |

Sessions: reuse `auth.ts` — pass link = an invite-style magic token with `sub = phone`;
session token keyed by phone. Owner/admin still logs in via `users.json`.

## Routes (all SSR)

- `GET /play` — public schedule; "I want to play" CTA routes by auth state.
- `GET /slot/:id` — shareable per-slot page (open or picked).
- `POST /slot/:id/join` — authed: append signup (soft capacity cap), prevent double-join.
- `POST /slot/:id/leave` — authed: tombstone.
- `POST /access/request` — public: submit WhatsApp → pending request + wa.me notify owner.
- `GET /auth/pass?token=…` — redeem pass link → phone session.
- Admin: pending-requests view → approve (mint pass link) / deny; recent signups.

## Phases (bead order)

1. **board-games-dc3** — Slot sync: calendar (ICS) → `slots.json` (worker). *No deps.*
2. **board-games-8jw** — Phone/WhatsApp access request → approve → pass link. *No deps.*
3. **board-games-mqs.1** — Phone-based session + login UI. *Needs 8jw.*
4. **board-games-mqs.2** — Public schedule `/play`. *Needs dc3.*
5. **board-games-8fy** — Join a slot (signup + capacity). *Needs dc3, mqs.1.*
6. **board-games-mqs.3** — Shareable slot links. *Needs mqs.2.*
7. **board-games-mqs.4** — Owner notification of requests & signups. *Needs 8jw, 8fy.*

Roughly: 1 & 2 in parallel → 3 & 4 → 5 → 6 & 7.

## Decisions I defaulted (flip any — each changes one bead)

1. **Calendar source = Google Calendar private ICS URL** (worker fetches, no OAuth —
   the Calendly-ish lazy path). Alternatives: Google Calendar API (OAuth; the vault's
   google-calendar plugin has client creds but an empty refresh token), or slots in an
   Obsidian note/base (consistent with `Users.md`, zero external API). → changes **dc3**.
2. **Game ↔ slot link = event title/description convention** (title matches a catalog
   game name; blank/unmatched = open slot). → changes **dc3**.
3. **WhatsApp notify/deliver = manual via `wa.me` deep links** (no dependency, free):
   requester's submit opens a prefilled message to the owner; owner approves in-app and
   sends the pass link. Upgrade path: WhatsApp Business API (Twilio/Meta) auto-messages —
   real dependency + cost, behind a flag. → changes **mqs.4** (and delivery in **8jw**).
4. **Capacity = soft cap** (append + recount; a hard cap needs a file lock). Fine at
   game-night scale. → changes **8fy**.

## Notes / risks

- ICS gives read-only availability. It does **not** create events on the owner's
  calendar (unlike the old dc3 wording). If you want bookings to write back to Google
  Calendar, that's the OAuth path — say so and I'll re-scope dc3.
- Phone auth replaces email login for guests; the owner/admin keeps `users.json`.
  Existing `tmp-users.jsonl` invite flow is subsumed by the pass-link flow.
