# Data resilience: last-good backup, push-triggered sync, instant promotions

Three workstreams, all from the 2026-09-05 outage + follow-up asks:
A — if Obsidian is down **and** the volume is empty/lost, the site still serves the last-good catalog and self-heals on the next sync cycle (instead of 0 games for weeks).
B — every push to the Obsidian vault repo syncs the site immediately; the 5-min board-games cron is **removed**, push becomes the only trigger (the wiring exists but has never fired).
C — promoting a cover in bg-admin reflects on live immediately (today: up to 24h of stale cache).

## Context

- Failure mode lived on 2026-09-05: `/data` empty (fresh filesystem) + Obsidian REST down → every 5-min sync failed at `catalog`, the `if (games.length)` guard skipped `catalog-write`, volume stayed empty forever, site served 0 games.
- Push-trigger chain exists and is deployed (verified live): GitHub webhook → `obsidian-repo-webhook-eventsource` → `obsidian-vault-sync` workflow (annotates `changed-files`) → board-games EventSource `board-games-obsidian-watch` (watches obsidian-ns Workflows for `Succeeded`) → Sensor `board-games-sync` (filter: annotation equals `Yuri/Resources/Board Games/Inventory`) → submits the sync template (mutex-serialized). It has **never fired**: recent vault-sync runs all Fail (one had `git-sync` in Error), so no Succeeded events exist; and the sensor filter is an exact string match on the annotation.
- Promotion staleness is cache-only (verified in code): `promote()` (`src/asset/studio.ts:110`) writes new bytes to the same `latest.png` path; the app pod serves them instantly (shared PVC, identity renderer), but `serve.ts:28` stamps `Cache-Control: public, max-age=86400` → browsers + Cloudflare edge hold the old image for up to 24h. The URL never changes across promotions.
- The worker already keeps last-good data on the volume when Obsidian fails (`worker/index.ts:133` guard) — the missing piece is a **second copy outside the volume**.
- Everything needed already exists in prod: `ASSETS_GCS_BUCKET` (`syscd-board-games-assets-d2a20e60-…`) + `GOOGLE_APPLICATION_CREDENTIALS` are wired into the sync WorkflowTemplate, init container, and app (verified live). `@google-cloud/storage` is already a dependency (`src/asset/store/gcs.ts`).
- Repo patterns to follow: structural bucket interface + injected fake (`GcsBucketLike`, `store/store.contract.test.ts`); atomic writes (`writeJsonAtomic`, `src/store.ts:59`); worker failure isolation via `step()` (`worker/index.ts:108`).

## A. Last-good store backup (GCS)

1. **New module `src/backup.ts`** (~70 lines, no new deps)
   - `BackupFile`-style structural interface for the GCS `File` API subset: `exists()`, `getMetadata()`, `download()`, `save()` — same fake-able shape as `GcsBucketLike` (`src/asset/store/gcs.ts:7`).
   - `openBackupBucket()` → `new Storage().bucket(process.env.BACKUP_GCS_BUCKET ?? process.env.ASSETS_GCS_BUCKET)`; returns `null` when neither is set (dev/local stays a clean no-op).
   - `backupStoreFiles(dataDir, files: string[])`: per file — read local, `sha256`; object name `_backup/<file>` (cannot collide with asset keys `<uuid>/…`); if remote object's `metadata.sha256` matches → skip (log `unchanged`); else `save()` with `contentType: application/json` + sha256 metadata (log `uploaded <size>`). Hash-gate matters: catalog is 8.4MB and backup runs on every sync — uploads only on real change.
   - `restoreMissingFiles(dataDir, files): Promise<number>`: per file — if local **missing or 0 bytes** and the backup object exists → download + atomic write (tmp + rename). Never overwrites a present local file. Returns count restored.
2. **Wire into the worker cycle** (`src/worker/index.ts`)
   - `const STORE_BACKUP_FILES = ["catalog.json", "users.json"];` (exactly the Obsidian-derived state).
   - First step in `cycle()`: `await step("restore", () => restoreMissingFiles(DATA_DIR, STORE_BACKUP_FILES));` — a fresh/lost volume is repopulated from GCS **before** the Obsidian attempt, so even a fully-down Obsidian leaves the site serving last-good data.
   - Last step: `await step("backup", () => backupStoreFiles(DATA_DIR, STORE_BACKUP_FILES));` — only runs meaningful work after a successful `catalog-write`.
3. **Chart/docs touch-ups** (no template changes needed — env already flows)
   - `chart/values.yaml`: one comment line under `assetsGcsBucket`: the bucket also mirrors `_backup/catalog.json` + `_backup/users.json` as the last-good store.
   - `src/store.ts` header comment: note the `_backup/` mirror next to the volume layout.
   - Optional `BACKUP_GCS_BUCKET` override already supported by step 1; don't add chart plumbing for it.

## Verification (A)

1. **Unit** — new `src/backup.test.ts` with an in-memory fake bucket (follow `store.contract.test.ts`):
   - upload writes object with sha256 metadata; identical second run makes **no** save call; changed local file triggers save;
   - restore writes the file when local missing; **skips** when local file exists and is non-empty; no-op when bucket unconfigured.
   - Run: `bun test src/backup.test.ts`, then full `bun test` (nothing else moves).
2. **Local end-to-end drill against the real bucket**
   - Seed: `task sync` (Obsidian reachable locally) → confirm `_backup/catalog.json` + `_backup/users.json` objects appear in the bucket with sha256 metadata.
   - Drill (proves the actual goal): fresh `DATA_DIR=$(mktemp -d)`, `OBSIDIAN_API_URL=https://127.0.0.1:9` (dead), `SYNC_ONCE=1 bun run src/worker/index.ts` → expect `restore: catalog.json, users.json` from GCS, `catalog failed:` (isolated), and the restored files present and parseable in `DATA_DIR`.
3. **Prod (after next image build + helm upgrade)**
   - `helm template` diff shows no unintended changes; submit a manual `board-games-sync` workflow → Succeeded; `/data/catalog.json` still valid; bucket objects present.
   - Optional full outage drill (disruptive — only on request): `kubectl -n obsidian scale deploy/obsidian --replicas=0`, wipe `/data/catalog.json` on the PVC, run manual sync, assert restored + site serves games, scale back up.

## B. Sync on Obsidian repo push

The chain exists and board-games' half is correctly deployed. What's broken is upstream + possibly the filter strictness.

1. **Fix `obsidian-vault-sync`** — every recent run Fails (`git-sync` container in Error on inspected pods). This lives in the obsidian infra (namespace `obsidian`, likely another repo): pull the failed workflow's `main`/`init` logs via Argo UI or `kubectl logs <pod> -c main` and fix (git creds/clone/path are the usual suspects). Board-games repo does not own this — flag the fix if it needs a PR there.
2. **Align the sensor filter with reality** — from the first Succeeded vault-sync, read the actual `changed-files` annotation value:
   - exactly `Yuri/Resources/Board Games/Inventory` → sensor already matches; nothing to do;
   - any other format (list, JSON, extra paths) → relax: drop the `changed-files` data filter in `chart/templates/workflow.yaml` Sensor and trigger on every Succeeded vault-sync — the sync is idempotent (fingerprint-deduped) and mutex-serialized, so extra runs are cheap and safe.
3. **Remove the board-games cron.** Delete the `CronWorkflow` `board-games-sync-cron` from `chart/templates/workflow.yaml` and run `kubectl -n board-games delete cronworkflow board-games-sync-cron` at apply time. Caveat: `obsidian-vault-sync` itself currently runs on its own 5-min cron in the obsidian namespace (epoch-named runs every 300s) — with only the board-games cron gone, syncs would stay periodic under a different name. True push-only means the obsidian side starts vault-sync from its webhook eventsource (already deployed) instead of its cron — same upstream-repo ownership as step 1.
4. **Accepted tradeoff — calendar/slots freshness.** Slots ride the same cycle: with no cron, new GCal availability blocks reach the site only on the next vault push or booking action (`/game/:id/book` re-syncs the calendar in-app, `src/index.ts:294`). Accepted per Yuri; revisit if slots staleness bites.
5. **Contract to document** (chart comment): vault-sync must label its Workflow `changed-files` and Succeed; board-games reacts.

### Verification (B)

- Push a real vault commit touching the inventory folder → `obsidian-vault-sync` Succeeds → a `board-games-sync-<generated>` workflow auto-submits and Succeeds → the note's change visible on the site within ~a minute of the push.
- Rapid successive pushes → the sync mutex serializes runs; no duplicate concurrent syncs.
- Cron truly gone: `kubectl -n board-games get cronworkflow` is empty and no new `board-games-sync-cron-*` workflows appear over the following hour.

## C. Promotion reflects immediately on live

Server-side pick-up is already instant (admin sidecar shares the PVC; `display` kind is served byte-for-byte). The 24h staleness is purely URL-level caching: same `latest.png?w&h&sig` URL before and after promote. Fix: give each promotion its own URL via an unsigned cache-buster param, without touching the stable Obsidian embed URL.

1. **Promotion marker** — `promote()` (`src/asset/studio.ts:110`) additionally records `<DATA_DIR>/displays.json`: `{ "<entity>/<face>": <epoch-ms> }` via `writeJsonAtomic` (`src/store.ts:59`). The admin process has `DATA_DIR` (same pod as the app, shared PVC).
2. **Read path** — `displayVersions(dataDir)` helper with a 30s TTL cache (mirror `loadGames`, `src/games.ts:44`); `renderHome` (`src/index.ts:102`) loads it once per render and passes the map into `collectionPage` props.
3. **URL change** — `signedDisplay` (`src/views.tsx:14`) appends `&v=<epoch>` when the map has an entry for that game+face. `v` is deliberately **unsigned**: `verifySigned` covers only path+w+h (`src/asset/auth.ts:37`), so no auth changes, and an unsigned `v` is harmless — it only keys the cache, it cannot fetch anything the signature doesn't already allow. Spines inherit via `signedSpine` (`views.tsx:26`).
4. **No serve-route change** — with a unique `v` per promotion, `max-age=86400` becomes correct per-URL: new URL = fresh fetch at browser and Cloudflare edge. The bare stable `latest.png` keeps its current behavior for Obsidian embeds.

### Verification (C)

- Unit: promote writes/updates `displays.json` (extend `studio.test.ts` with a temp DATA_DIR); views test asserts `signedDisplay` embeds `v` when provided (extend the views tests).
- Local: run admin + app, promote a candidate, hard-reload the site → the box shows the new art immediately; second render keeps the same `v` (no pointless cache churn).
- Prod: promote via bg-admin → hard-reload `bg.syscd.live` → new cover immediately, no 24h wait.

## Out of Scope
- `signups.jsonl`, `tmp-users.jsonl`, `access-requests.jsonl` (app-owned runtime data; would need an app-side write hook — separate plan).
- `slots.json` (calendar-derived, syncs independently of Obsidian; a stale snapshot could resurrect past sessions — skip).
- `assets/` covers (originals already durable in GCS via the asset pipeline; the disk cache is by design rebuildable).
- App-side restore-on-miss (volume loss while running self-heals on the next vault-push sync or app-pod restart via the init-container restore; acceptable).
- The `healthz catalogCount` / `ENOENT`-vs-`EIO` observability fix — separate follow-up, complements this one.
