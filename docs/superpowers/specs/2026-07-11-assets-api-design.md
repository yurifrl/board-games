# Assets API — Design

**Date:** 2026-07-11
**Status:** Approved

## One line

An image-aggregator API for the board-games app. The frontend requests a game
image by its Obsidian UUID plus the size it wants; the API serves it from a
local disk cache backed by a private Google Cloud Storage bucket, filled from
Ludopedia/BGG at sync time. Resize-once, cache-forever.

## Why

Today the worker downloads covers into the `data/` volume via `src/covers/`.
We want a durable, shared image store (GCS) so the app can request arbitrary
sizes on demand without re-hitting Ludopedia/BGG, without exposing the bucket
to the open internet (billing protection), and without letting other domains
hotlink the endpoint.

## Grounded facts (from the live vault)

- Each inventory note's frontmatter `id` is a **UUID**
  (`23c704cc-f2bf-4a07-b181-adcfaee16bab`). It is unguessable — this is the
  anti-enumeration id and the flat cache key.
- Provider ids vary per game: some notes have both `bgg/id` and
  `ludopedia/id`, some have only one, some have neither. Games with **neither**
  provider id are skipped (nothing to fetch).
- `image/grid` is a low-res BGG thumbnail URL already present in some notes
  (the existing `bggImageUrl` fallback).

## Architecture

### Key layout (flat, keyed by the game UUID)

```
<uuid>/original.jpg      # best image the resolver found (ludopedia preferred, bgg fallback)
<uuid>/<W>x<H>.jpg       # derivative sizes, generated on demand and cached
```

Provider is an internal fetch detail, not part of the key. One canonical
original per game.

### Write side — worker fills GCS

The worker (`src/worker/index.ts`) already syncs games from Obsidian and runs
`resolver.sync()`. Change: for each synced game that has a `bggId` or
`ludopediaId`, the resolver fetches the best available image and uploads the
**original** to the private GCS bucket at `<uuid>/original.jpg`. Games with
neither id are skipped. GCS becomes the durable aggregate store, replacing
"save into `data/`".

### Read side — API serves formats

```
GET /assets/<uuid>?w=300&h=300&sig=<hmac>&exp=<unix>
  verify signature + expiry ──fail──▶ 401
  local disk <uuid>/<W>x<H>.jpg hit? ──▶ 200 (bytes)
  else GCS <uuid>/original.jpg exists?
       ├ yes → sharp resize → write variant to disk → 200
       └ no  → 202 (not filled yet — worker fills on next sync)
                or 404 (game has no provider ids, nothing will ever fill)
```

The frontend only ever calls `/assets/<uuid>?w=&h=`. It never talks to GCS or
the providers.

## Components

1. **`src/assets/signing.ts`** — `sign(id, params)` / `verify(req)` using
   HMAC-SHA256 over `id + params + exp`, with an expiry check. The app mints
   URLs; the API verifies. Shared secret from env (`ASSETS_SIGNING_SECRET`).
2. **`src/assets/gcs.ts`** — read/write to the private bucket. Authenticated
   via a service-account key JSON (from the `board-games-gcs-creds` secret /
   `GOOGLE_APPLICATION_CREDENTIALS`); the API is the only credential holder.
   Methods: `head(key)`, `get(key)`, `put(key, bytes, contentType)`.
3. **`src/assets/store.ts`** — local disk variant cache, flat key
   `<uuid>/<WxH>.jpg`. Generalizes the existing `FsCoverStore` pattern
   (`src/covers/store.ts`).
4. **`src/assets/resize.ts`** — `sharp`: resize/crop to requested `w`/`h`,
   returning JPEG bytes. Called once per (uuid, size); result is cached.
5. **`src/assets/route.ts`** — the Hono handler implementing the read-side
   flow above. Mounted in `src/index.ts`.
6. **Worker change** — extend the cover resolver/store so `resolver.sync()`
   uploads `<uuid>/original.jpg` to GCS; skip games with no provider id.

### Reuse

- `src/covers/providers/{bgg,ludopedia}.ts` — provider fetch logic, unchanged.
- `src/covers/resolver.ts` — tier-based best-image selection, unchanged logic;
  the store it writes to changes to a GCS-backed store.
- `src/covers/store.ts` `FsCoverStore` — the model `store.ts` generalizes.

## GCS provisioning (home-systems, Crossplane)

The `k8s/charts/crossplane-gcp` chart is fully generic (templates iterate over
values); **no template changes are needed**. Provisioning is values entries.
Real names are secret and live in the private `home-systems-values` repo
(`gcp/values.yaml`); public commented examples were added to the chart's
`values.yaml`.

The cluster is **Talos, not GKE**, so GKE Workload Identity is unavailable. The
API authenticates to GCS with a **service-account key JSON** that Crossplane
mints (`ServiceAccountKey`) and writes to a k8s Secret
(`board-games-gcs-creds`) the app mounts.

Resources (add to private values):

```yaml
buckets:
  - name: board-games-assets
    externalName: <real-bucket-name>
    location: us-east1
    storageClass: STANDARD
    uniformBucketLevelAccess: true
    publicAccessPrevention: enforced        # no open-internet reads
serviceAccounts:
  - name: board-games-assets-sa
    accountId: board-games-assets-sa
    displayName: board-games assets bucket access
bucketIAMMembers:
  - name: board-games-assets-admin          # ONLY this SA can touch the bucket
    bucketRef: board-games-assets
    role: roles/storage.objectAdmin
    member: "serviceAccount:board-games-assets-sa@<project>.iam.gserviceaccount.com"
serviceAccountKeys:
  - name: board-games-assets-sa-key
    serviceAccountRef: board-games-assets-sa
    writeConnectionSecretToRef:
      namespace: board-games
      name: board-games-gcs-creds
```

Result: only the API's SA has access (`publicAccessPrevention: enforced` +
no other IAM members). Cost is bounded by the API alone — no billing blowout.

## Error handling

| Case | Response |
|---|---|
| Bad / expired / missing signature | 401 |
| Variant cached on disk | 200 |
| Original in GCS, variant not yet made | resize, cache, 200 |
| Game has provider id(s) but not filled yet | 202 (retry later) |
| Game has no provider ids (nothing will fill) | 404, negative-cached |
| Provider temporarily rate-limited (write side) | reuse `ProviderUnavailableError`, defer to next sync |

Negative-cache the "no provider ids" 404 so we don't re-check a known-absent
game on every request.

## Testing

One runnable self-check per non-trivial unit (assert-based, no framework):

- `signing.ts` — sign→verify round-trip passes; tampered/expired sig fails.
- `store.ts` — key builder produces `<uuid>/<WxH>.jpg`; has/get/put round-trip.
- `resize.ts` — output image has the requested dimensions.
- `gcs.ts` — head/get/put against a mock or the emulator.

## Explicitly skipped (YAGNI)

- **Separate proxy service** — a private bucket + single-credential API already
  guarantees "only this API reads GCS". Add a proxy only if we ever need to
  read from a source that can't be locked down by IAM.
- **External job queue** — the worker's sync cycle is the fill trigger; an
  in-memory in-flight dedup set is enough for read-side background fills. Add a
  real queue only if fill volume outgrows one process.
- **Pre-generating every size** — resize-on-demand + cache covers it. Add a
  warm-up pass only if first-request latency becomes a problem.
- **Provider level in the key** — flat UUID key; the resolver already picks the
  single best provider image.
