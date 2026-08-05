# Admin Cover Studio — design

An isolated admin service (`bg-admin.*`) for managing each game's **front cover**
and **spine** image: pull candidates from pluggable **providers** (upload first,
then AI, then Ludopedia/BGG), keep a **history** per format, **promote** one to
the chosen slot, and have the public app show the pick **immediately**.

This is a **control-plane inversion**: the worker stops being smart (no cover
resolution, no generation) and becomes a dumb GCS→disk mirror. All image
decisions move to `bg-admin`. GCS is the source of truth.

## Deployment

- Own container, own image, **same Helm release** as app/worker.
- **Shared PVC** with the app — this is what makes cache invalidation nearly free.
- **No Ingress** — reachable only inside the cluster (closed on access). No
  internet exposure. Keep its context minimal (no user data, no auth secrets it
  doesn't need).

## Data model (the core)

Everything is addressed by a folder key on GCS (origin) + disk (cache), reusing
the existing `AssetKey`/`keyPath` machinery with the axes reordered:

```
<id>/<provider>/<format>/<version>.<ext>   ← every candidate (history)
<id>/display/<format>/latest.<ext>          ← the chosen image (stable name)
```

| segment | meaning | values |
|---|---|---|
| `id` | game (Obsidian uuid) — never changes; a new id = a fresh world | `clank` |
| `provider` | uniform across all sources | `upload` `openai` `google` `ludopedia` `bgg` |
| `format` | the named output a provider declares it produces | `front` `spine` `cover` `grid` |
| `version` | history entry; newest = "latest of this format" | epoch ms |

- **Providers are uniform.** A provider only differs in which formats it
  populates: `upload`→{whatever you upload as}, `openai`/`google`→{front, spine},
  `ludopedia`→{cover}, `bgg`→{cover, grid}.
- **History is free**: list prefix `<id>/<provider>/<format>/`.
- **dimensions, prompt used, contentType, fingerprint = metadata** stored with the
  blob, never key segments. You pick an *image*, not a size; the app resizes on
  demand (it already does).
- **Promote = copy bytes** onto `<id>/display/<format>/latest.<ext>` (writes GCS
  origin + shared disk cache). A real standalone file at a stable name → Obsidian
  embeds it once and it always resolves.

Delimiter is `/` (folders), not `:` or `-` — the backends are object stores and
every core op (history, delete-game, delete-provider) is a prefix scan.

## Public app contract

**Cover and box-art-front collapse into one concept.** The public app renders
only:

- `<id>/display/front/latest.*` — the game's image (shelf front face + catalog)
- `<id>/display/spine/latest.*` — the spine

The old "cover pulled from bgg/ludopedia" is gone as a *concept*; bgg/ludopedia
become **providers you promote into `display/front`**. Missing display slot →
existing tinted fallback (unchanged onerror behavior).

## Cache invalidation

Shared volume + the service's fingerprint-tagged derivative cache do most of it:
promote overwrites `latest.*` with new bytes → new fingerprint → app re-renders
derivatives on next request. The promote handler also drops stale derivative
variants of that display key so nothing serves the old pick.

## Providers = the existing `AssetSource` seam

`upload`, `openai`, `google`, `ludopedia`, `bgg` are all `AssetSource`s. A page
is not bespoke: it's the same flow (list candidates from a provider → manage →
promote) with a different provider behind it.

## Prompts (AI slice)

- Front = `global styling` + `per-game style (Obsidian)` + `front prompt`
- Spine = `global styling` + `per-game style (Obsidian)` + `spine prompt`
- **Obsidian is the prompt DB** via the REST API (`worker/obsidian.ts:setFrontmatter`):
  per-game `style` field + a global prompt file at a configured path
  (default `Yuri/Resources/Board Games/Inventory/Inventory.md`).
- Live prompt editing in the UI; drafts in localStorage; save writes to Obsidian.

## UI

- Three views: **front-only**, **spine-only**, **both**. Hover previews the other.
- Front and spine are separate formats: separate prompts, separate history,
  generated separately.
- Grid of games; per game: chosen slot + history strip; promote, upload, delete
  (from GCS / from disk).
- Responsive / mobile.

## Slice plan (build order)

1. **Plumbing MVP** — data model + admin shell (own sidecar container in the app
   pod, shared volume, internal `bg-admin` Service, no ingress) + asset
   management (CRUD) + **upload provider** + promote + **cache invalidation so
   the pick shows on the front immediately**. Public app prefers `display/front`
   + `display/spine`, falling back to the existing cover/gen art so nothing
   regresses before anything is promoted.
2. **AI provider (the goal)** — openai/google front+spine, history, live prompt
   editing, prompt composition, prompt-from-Obsidian, bulk generate.
3. **Downloaded-covers picker + GCS→disk mirror** — ludopedia/bgg as providers,
   async choose job, first-load "download all" + refresh-cache. The worker
   becomes a dumb GCS→disk mirror **here** (not sooner): only once GCS actually
   holds studio images and bgg/ludopedia are promotable can cover resolution
   safely leave the worker without blanking un-promoted covers.

Worker stays as-is through slices 1–2 (keeps feeding the cover fallback); it
flips to a mirror in slice 3, alongside the feature that repopulates the volume.
