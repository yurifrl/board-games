# board-games chart

Public board-game catalog. The **image is public** (code only) — all private
data arrives at runtime:

- **Inventory** — a `git-sync` sidecar pulls the private repo into an `emptyDir`;
  the app reads `<repo>/<gitSync.subPath>`. See `examples/inventory/` for the
  `.md` frontmatter format (`bgg/id`, `ludopedia/id`, `price`, ...).
- **Covers** — a `cover-sync` sidecar runs the idempotent cover tool on a loop,
  writing full-res covers into a **PVC** cache (`/cache/covers`). Survives
  restarts; only fetches what's missing/upgradable.
- **Roles** — non-secret `whitelistConfig` (values) → ConfigMap.
- **Users + secrets** — a Secret (`secretName`, default `board-games`).

## What the USER provides (Secret `board-games`)

| Key | What |
|-----|------|
| `GITSYNC_PASSWORD` | GitHub **PAT** with read access to the inventory repo |
| `AUTH_SECRET` | `openssl rand -hex 32` |
| `users` (+ per-user keys) | `role:identifier=password` (e.g. `admin:you@x.com=pw`) |
| `WHATSAPP_NUMBER` | optional |

Plus set `gitSync.repo`, `gitSync.subPath`, `hosts`, `baseUrl` in values.

## Volumes

| Mount | Type | Holds |
|-------|------|-------|
| `/git` | emptyDir | git-synced repo (inventory) |
| `/cache` | **PVC** | cover cache + `tmp-users.jsonl` (idempotent) |
| `/config` | ConfigMap | role config |
| `/secrets` | Secret | users + AUTH_SECRET |

The image carries no inventory, covers, or credentials — safe to publish publicly.
