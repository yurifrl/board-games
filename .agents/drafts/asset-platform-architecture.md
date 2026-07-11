# Asset Platform — Architecture Proposal (draft)

Status: draft for review. Goal: replace the ad-hoc, image-only, `if-source`
cover pipeline with a composable asset platform that stores **any** asset type
(covers, rulebooks, future kinds), from **any** source (pulled from BGG/Ludopedia
or **pushed** by an agent via token), and serves them to browsers **and** AI
agents.

---

## 1. Grill: what's wrong with what exists today

Concrete, file-level. I wrote most of this, so this is a self-audit.

1. **Conditional dispatch on source.** `covers/keys.ts:coverKeyCandidates` hardcodes
   `if g.ludopediaId … if g.bggId …` in a fixed order. `views.tsx:coverSrc` does
   `g.bggId ? "bgg" : g.ludopediaId ? "ludopedia" : null`. `index.ts:buildCoverResolver`
   hardcodes the provider list. Every new source touches 3+ files and adds a branch.
   This is the exact "add `if othersource?`" the review calls out.

2. **Image assumptions baked into the "generic" layer.** `assets/store.ts` hardcodes
   `.jpg` and `WxH` variants. `assets/resize.ts` (sharp/JPEG) sits on the serving path
   unconditionally. `signing.ts` params are `w/h`. A rulebook is a PDF with no `w/h`
   and no resize — none of this composes to it.

3. **Two names, one concept, split badly.** `src/covers/` (pull + FS cache + meta) and
   `src/assets/` (GCS + local variant cache + resize + serve) are two half-abstractions
   of the same thing. `fill.ts` is glue that re-reads `covers/`'s `cover.json` sha and
   re-derives GCS keys — a seam that only exists because the two halves don't share a
   storage model.

4. **Only one ingestion model.** Everything assumes *pull* (worker fetches from a
   provider). Rulebooks are *push* (Hermes uploads them). There is no ingest path, no
   token auth, no write API.

5. **Serving assumes one audience.** Signed URLs for browsers only. No agent-facing
   read path, no token-scoped access, no "give me the rulebook as text/PDF" endpoint.

6. **Tests test the wrong things.**
   - `resize.test.ts` asserts sharp resizes to `300x300` — that tests **sharp**, not our
     code. Delete.
   - The in-memory GCS fake is **copy-pasted** in `gcs.test.ts`, `route.test.ts`,
     `fill.test.ts` — 3 divergent definitions. Redundant and drift-prone.
   - No test exercises the thing that actually matters and keeps breaking: **source
     composition** (do we store *all* sources? does a changed source refetch?).
   - Net: lots of assertions, little confidence. Matches the "flaky and redundant" call.

---

## 2. Core model

One domain: **Asset**. Everything is an asset with a structured key.

```
AssetKey = {
  entity:  string   // the game uuid (extensible to other entity types later)
  kind:    string   // "cover" | "rulebook" | ...        (open set)
  source:  string   // "bgg" | "ludopedia" | "hermes" | ...(open set)
  variant: string   // "original" | "300x300" | "page-1" | ...
  ext:     string   // "jpg" | "pdf" | "txt"
}
// serialized path: <entity>/<kind>/<source>/<variant>.<ext>
```

The key is the ONLY place layout lives. No source/kind literals anywhere else.

```
AssetBlob   = { bytes: Uint8Array; contentType: string; fingerprint?: string }
AssetRecord = AssetKey & { contentType; bytes; sha256; fingerprint?; fetchedAt }
```

`fingerprint` = a stable signature of the upstream source (BGG image URL, Ludopedia
id, uploaded file sha). Change-detection lives on this, uniformly.

---

## 3. Layers (each a small interface + swappable impls)

### 3a. Storage — `BlobStore` (composition, not a bespoke fill.ts)

```
interface BlobStore {
  head(k: AssetKey): Promise<AssetRecord | null>
  get(k: AssetKey): Promise<AssetBlob | null>
  put(k: AssetKey, b: AssetBlob): Promise<AssetRecord>
  list(prefix: Partial<AssetKey>): Promise<AssetKey[]>   // e.g. all rulebooks of a game
}
```

Impls: `GcsBlobStore` (durable origin, private bucket), `DiskBlobStore` (cache/volume).
Composed by:

```
class TieredBlobStore implements BlobStore {   // read-through / write-through
  constructor(cache: BlobStore, origin: BlobStore) {}
  get: cache.get ?? (origin.get -> cache.put -> return)
  put: origin.put ; cache.put            // write reaches durable + local
}
```

This **deletes `fill.ts`**: sources write to the store; the store handles GCS+disk.
`needsUpdate(key, fingerprint)` (compare stored record's fingerprint) replaces the
sha-in-cover.json dance, uniformly for every kind.

### 3b. Ingestion — two shapes, one sink

**Pull** (`AssetSource`) — for provider-fetched assets (covers now, more later):

```
interface AssetSource {
  readonly id: string          // "bgg"
  readonly kind: string        // "cover"
  discover(e: Entity): Promise<DiscoveredAsset[]>   // [] when it has nothing
}
interface DiscoveredAsset {
  key: AssetKey
  fingerprint: string
  fetch(): Promise<AssetBlob>  // lazy — only called if needsUpdate
}
```

The pipeline has **zero source branches**:

```
for (const s of sources)
  for (const a of await s.discover(entity))
    if (await store.needsUpdate(a.key, a.fingerprint))
      await store.put(a.key, { ...await a.fetch(), fingerprint: a.fingerprint })
```

Adding BGG-gallery, a 3rd site, or a new kind = **one new `AssetSource`**, registered
in a list. No `if`. This replaces `CoverResolver` + `coverKeyCandidates` + tier logic
(tier becomes a per-source `priority` field used only to pick a default when serving).

**Push** (`ingest`) — for agent-uploaded assets (rulebooks): an HTTP handler with a
bearer token that writes straight to the same `BlobStore.put`. Not an `AssetSource`
(nothing to discover). Same sink, so serving/caching are identical.

### 3c. Rendering — `AssetRenderer` keyed by kind (no `if kind===image`)

```
interface AssetRenderer {
  readonly kind: string
  render(blob: AssetBlob, params: URLSearchParams): Promise<AssetBlob>
}
renderers: Map<kind, AssetRenderer>
// cover -> sharp resize/crop ; rulebook -> identity (pass-through) ; text -> extract (later)
```

Serving looks up `renderers.get(key.kind)`; unknown kind → identity. Resize stops being
a hardcoded step and becomes the cover renderer.

### 3d. Auth — `Authorizer` strategies per route

```
type Authorizer = (req) => boolean | Promise<boolean>
signedUrl   // browser image/rulebook links (HMAC, existing signing.ts, params generalized)
bearerToken(env) // ingest (Hermes) + agent read; separate scoped tokens
```

---

## 4. Directory layout (unify covers/ + assets/ into one domain)

```
src/asset/
  key.ts            AssetKey (build/parse/serialize) — the only place layout lives
  types.ts          BlobStore, AssetSource, AssetRenderer, AssetBlob, AssetRecord
  store/
    gcs.ts          GcsBlobStore
    disk.ts         DiskBlobStore
    tiered.ts       TieredBlobStore (cache over origin)
  sources/
    registry.ts     the source list (the ONE place you add a source)
    bgg-cover.ts     AssetSource (geekdo original via image/grid pic id)
    ludopedia-cover.ts
  render/
    registry.ts
    image.ts        sharp resize/crop (cover)
    passthrough.ts  rulebook/pdf
  ingest.ts         push endpoint (token) -> BlobStore.put
  serve.ts          GET route: auth -> store.get -> render -> respond
  pipeline.ts       pull loop over sources (used by worker)
  auth.ts           signedUrl + bearerToken
```

`src/covers/` and `src/assets/` are deleted/migrated. `worker/index.ts` calls
`pipeline.run(games)`; `index.ts` mounts `serve` + `ingest`.

---

## 5. Rulebooks end-to-end (the new requirement)

1. **Token.** New env `ASSET_INGEST_TOKEN` (+ `ASSET_AGENT_TOKEN` for reads). Given to
   Hermes.
2. **Ingest API.** `POST /ingest/:entity/:kind` (`Authorization: Bearer <ingest-token>`),
   body = file bytes, headers `Content-Type` + `X-Asset-Name`. Handler builds
   `AssetKey{entity, kind:"rulebook", source:"hermes", variant:<name>, ext:"pdf"}` and
   `store.put`. Hermes uploads rulebook PDFs here.
3. **UI.** Game page lists `store.list({entity, kind:"rulebook"})` → renders signed
   `/asset/<entity>/rulebook/hermes/<name>.pdf` links (open/download).
4. **Agent serving.** `GET /agent/assets/:entity?kind=rulebook` (`Bearer <agent-token>`)
   → JSON list; `GET /agent/assets/<...key>` → the PDF bytes. (Text extraction for LLM
   context is a later `text` renderer / `rulebook→txt` variant; out of scope for v1,
   noted.)

Covers and rulebooks now share storage, caching, keying, auth, and serving — they
differ only in a registered source (pull vs push) and a registered renderer.

---

## 6. Migration (incremental, stays green each step)

- **P1 — Storage core.** `AssetKey` + `BlobStore` (gcs/disk/tiered). Port image serving
  onto it behavior-preserving. Delete `fill.ts`, fold into `store.put` + `needsUpdate`.
- **P2 — Source registry.** Replace `CoverResolver`/`coverKeyCandidates`/`buildCoverResolver`
  with `sources/registry.ts` + `pipeline.run`. Kills the `if-source` branches.
- **P3 — Render registry + generalized signing** (params, not w/h). Cover renderer =
  today's resize.
- **P4 — Ingest API + rulebook kind** (token auth) + UI listing.
- **P5 — Agent read API** (agent token).

Each phase is independently shippable and keeps the app serving.

---

## 7. Test strategy (fix "flaky and redundant")

- **One shared `InMemoryBlobStore`** fake in a test-util module; delete the 3 copy-pasted
  GCS fakes.
- **Contract test** for `BlobStore` run against InMemory (and, if worth it, a GCS
  emulator) — head/get/put/list/needsUpdate semantics once, for all backends.
- **Behavior tests that map to real risks:**
  - pipeline stores **every** source's asset (compose 2 fake sources → assert both keys
    present); a changed fingerprint refetches, an unchanged one doesn't.
  - render registry dispatches by kind (cover→resized, rulebook→identical bytes).
  - ingest rejects a bad/absent token, accepts a good one, writes the right key.
  - signed-URL auth round-trip + tamper (keep — it's our logic).
- **Delete** the sharp-dimension test (tests the library) and per-size trivia.
- **No network in unit tests.** Live checks, if ever needed, are a committed
  `bun run` command in the repo (a real task), never inline `-e` scripts.

---

## 8. Assumptions made (confirm at the end)

1. Entity = game uuid; key layout leaves room for other entity types but I'm not
   building them now.
2. GCS stays the durable origin; local disk/volume is the cache. Two-tier store.
3. Separate tokens: `ASSET_INGEST_TOKEN` (Hermes write) and `ASSET_AGENT_TOKEN`
   (agent read). Browser stays on HMAC signed URLs.
4. Rulebooks stored as PDF as-uploaded; agent gets the PDF. LLM text extraction is a
   later renderer, not v1.
5. "All images" from BGG/Ludopedia = **both sources' covers** now; full **galleries**
   become additional `AssetSource`s later (same pattern, no redesign) — not in this
   change.
6. `tier` becomes per-source `priority`, used only to choose the default served source.
7. Unify `covers/` + `assets/` into `src/asset/`; old modules migrated then deleted.

## 9. Open questions for you

- OK to **delete `src/covers/` and `src/assets/`** and migrate to `src/asset/`, or keep
  them side-by-side during migration?
- Rulebooks: **PDF only**, or also accept images/other files under `kind:"rulebook"`?
- Agent read auth: **one shared agent token**, or per-agent tokens (needs a small token
  store)?
- Should the ingest API also **trigger** anything (e.g. notify the app), or just store?
