# board-games — Board Game Collection + Private Bidding

A Bun + Hono web app that renders a board-game collection server-side. A
**worker sidecar** pulls the inventory, users, and covers from an Obsidian
vault (via the [Obsidian Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api))
into a single volume; the app reads only from that volume. Whitelisted users
sign in with a **stateless password login** (no database, no session store).
Games flagged `for_sale: true` show a price and a **Make a bid** button that
opens WhatsApp with a prefilled message.

## Architecture

```
Obsidian vault ──REST API──▶ Worker ──▶ Volume (DATA_DIR)
                                   ├── catalog.json   (flattened games)
                                   ├── users.json     (roles + permanent users)
                                   ├── covers/<key>/  (cover cache)
                                   └── tmp-users.jsonl (runtime temp users)

                                   App ──reads──▶ Volume ──SSR──▶ HTML
```

- **Worker** (`src/worker/`): long-running sidecar (or one-shot via `SYNC_ONCE=1`).
  Polls the Obsidian REST API every `SYNC_INTERVAL_MS`, parses the inventory
  `.md` notes + `Users.md`, and writes `catalog.json` + `users.json` (atomic).
  Then runs the cover pipeline into `covers/`. Self-signed TLS bypass is
  worker-only.
- **App** (`src/index.ts`): reads `catalog.json` + `users.json` from the volume,
  groups games, applies the viewer's permission, and server-renders the page.
  Never talks to Obsidian directly.
- **Temp users** (`tmp-users.jsonl`): runtime state created by the admin invite
  flow; lives in the volume, the worker never touches it.

## Auth model — roles + users from `Users.md`

`Users.md` (in the vault, at `Yuri/Resources/Board Games/Users.md`) holds both
the role config and the permanent user list:

```yaml
---
defaultRole: viewer
roles:
  admin:  { canSeePrices: true, canBid: true, admin: true }
  buyer:  { canSeePrices: true, canBid: true }
  viewer: { canSeePrices: false, canBid: false }
users:
  - identifier: you@example.com
    password: admin-password
    role: admin
  - identifier: friend@example.com
    password: buyer-password
    role: buyer
---
```

The worker syncs this into `users.json` on the volume; the app reads from there
(30s cache). Passwords are plaintext in the vault and compared in constant time.

### Temporary users (JSONL store)

Signed in as admin, the collection page shows an *Invite a temporary user* form:
enter an email, pick a role, get a **login link** that never expires. The temp
user is appended to `tmp-users.jsonl`; access is governed there (remove the
record to revoke). Admin role can't be granted to temp users.

## Expansions

Games with `type: "expansion"` and an `expansion-of:` matching a base game's
`name` are nested under that base in the UI. Orphans show as top-level cards.

| Capability     | Effect                                                       |
|----------------|--------------------------------------------------------------|
| `canSeePrices` | Reveals price / sale price on cards                          |
| `canBid`       | Shows the **Make a bid** button on `for_sale` games          |
| `admin`        | Sees everything + implies `canSeePrices` and `canBid`        |

## Covers (local cache, pluggable sources)

Covers live in `data/covers/<source>-<id>/` (`cover.jpg` + `cover.json` sidecar),
filled idempotently by the worker. The app serves them via `GET /covers/:id` and
never depends on a remote. Sources: `LudopediaProvider` (tier 30, full-res) and
`BggImageProvider` (tier 10, the `image/grid` fallback). Add a provider in
`src/covers/index.ts`; nothing else changes. The resolver skips covers already
cached at an equal/better tier, upgrades when a better source appears, and never
downgrades.

## Inventory note format

Games are parsed from the YAML frontmatter of `.md` files in the vault folder
`Yuri/Resources/Board Games/Inventory`. Recognized fields: `id`, `name`,
`language`, `type`, `expansion-of`, `price`, `purchase/source`,
`purchase/date`, `tags`, `bgg/url`, `bgg/id`, `ludopedia/url`, `ludopedia/id`,
`image/grid`. To list a game for sale:

```yaml
for_sale: true
sale_price: "R$ 250,00"   # optional; falls back to `price`
```

## Configuration

| Env | Default | Purpose |
|-----|---------|---------|
| `DATA_DIR` | `./data` | Single volume: catalog, users, covers, tmp-users |
| `AUTH_SECRET` | — | HMAC secret for session cookies (generate: `openssl rand -hex 32`) |
| `BASE_URL` | `http://localhost:3000` | Public base URL (cookie Secure flag auto-set on https) |
| `WHATSAPP_NUMBER` | — | WhatsApp number in international format, digits only |
| `OBSIDIAN_API_URL` | `https://localhost:27124` | Obsidian Local REST API URL (worker only) |
| `OBSIDIAN_API_KEY` | — | Obsidian API key (worker only) |
| `OBSIDIAN_INVENTORY_FOLDER` | `Yuri/Resources/Board Games/Inventory` | Vault folder (worker) |
| `OBSIDIAN_USERS_NOTE` | `Yuri/Resources/Board Games/Users.md` | Users note path (worker) |
| `SYNC_INTERVAL_MS` | `300000` | Worker poll interval (worker only) |
| `LUDOPEDIA_ACCESS_TOKEN` / `LUDOPEDIA_COOKIE` | — | Optional: resolve missing Ludopedia ids (worker) |

## Run locally

```bash
bun install
export AUTH_SECRET=$(openssl rand -hex 32)
SYNC_ONCE=1 bun run src/worker/index.ts   # one-shot sync from Obsidian → ./data
bun run dev                                # app reads from ./data
```

The worker needs the Obsidian Local REST API plugin running (default port 27124)
and `OBSIDIAN_API_KEY` set (or hardcoded as a fallback in `src/worker/obsidian.ts`).

## Deploy (k8s)

The `chart/` deploys two containers sharing one PVC (`/data`): the worker
(populates the volume) and the app (reads from it). Secrets (`OBSIDIAN_API_KEY`,
`AUTH_SECRET`, optional Ludopedia creds) come from a Secret named
`secretName`. See `chart/values.yaml`.

## Endpoints

| Route            | Purpose                                  |
|------------------|------------------------------------------|
| `GET /`          | Collection (or login page if signed out) |
| `POST /auth/login` | Verify email + password, set session cookie |
| `POST /admin/invite` | Admin-only: mint a temp-user invite link |
| `GET /auth/invite` | Redeem an invite link → temp session     |
| `GET /auth/logout` | Clear the session cookie               |
| `GET /covers/:id` | Cached cover image                       |
| `GET /healthz`   | Health check                             |
