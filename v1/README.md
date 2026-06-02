# board-games — Board Game Collection + Private Bidding

A tiny Bun + Hono web app that renders a board-game collection from inventory
`.md` notes. Whitelisted users sign in with a **stateless
password login** (no database, no session store, no email). Games flagged
`for_sale: true` show a price and a **Make a bid** button that opens WhatsApp
with a prefilled message.

## Why stateless?

Nothing is persisted server-side. The only secret is `AUTH_SECRET` (an env var):

- **Login** verifies email/name + password against the merged whitelist (plaintext, constant-time compare).
- **Session** = a signed JWT (`{email, exp}`) in an `httpOnly` cookie.
- The token *is* the record — no DB, no Redis, no session table.

Trade-off: sessions can't be revoked early, only expire (`SESSION_TTL_DAYS=7`).
The whitelist is re-read on **every** request (30s cache), so removing a user or
changing a role/password takes effect on their next request.

## Auth model — RBAC from two sources

The effective whitelist is **merged at runtime** from:

1. **Role config** (`WHITELIST_CONFIG_PATH`, YAML, non-secret — a ConfigMap in
   k8s): role → capabilities + a `defaultRole`.
   ```yaml
   defaultRole: viewer
   roles:
     admin:  { canSeePrices: true, canBid: true, admin: true }
     buyer:  { canSeePrices: true, canBid: true }
     viewer: { canSeePrices: false, canBid: false }
   ```
2. **Users** (`WHITELIST_USERS_PATH`, one secret blob — a mounted Secret in k8s):
   one line per user, **plaintext** password.
   ```
   role:identifier=password      # identifier = email or name
   identifier=password           # no prefix -> defaultRole
   ```
   e.g. `admin:you@example.com=s3cret`, `viewer:foo@bar.bet=pw`. An unknown role
   falls back to `defaultRole`.

Capabilities: `admin` implies `canSeePrices` + `canBid`. Passwords are plaintext
because the source is an encrypted Secret; they're compared in constant time.

## Temporary users (JSONL store)

Signed in as an **admin**, the collection page shows an *Invite a temporary user*
form: enter an email, pick a role (preset via `DEFAULT_INVITE_ROLE`, changeable
in the dropdown), and get a **login link**.

- The temp user is appended to an append-only JSONL "database" (`TMP_USERS_PATH`)
  — one JSON record per line, last-wins per email, with `deleted: true`
  tombstones for revocation. No real DB.
- Invite links **do not expire**. Access is governed by the store: a temp user's
  roles are resolved from the JSONL on **every request**, so changing or removing
  their record takes effect immediately.
- The session cookie only marks the user as temporary (`tmp:true`) + their email;
  roles are never trusted from the token, only from the store.
- Admin role can't be granted to temp users. Temp users never see the invite form.

```jsonl
{"email":"guest@example.com","roles":["buyer"],"createdBy":"you@example.com","createdAt":"2026-05-30T12:00:00.000Z"}
{"email":"guest@example.com","roles":[],"deleted":true,"createdAt":"2026-05-31T09:00:00.000Z"}
```

## Expansions

Games with `type: "expansion"` and an `expansion-of:` matching a base game's
`name` are **nested under that base game** in the UI (each expansion keeps its
own for-sale/price/bid controls). An expansion whose base game isn't in the
collection is shown as its own top-level card so nothing disappears.

| Capability     | Effect                                                       |
|----------------|--------------------------------------------------------------|
| `canSeePrices` | Reveals price / sale price on cards                          |
| `canBid`       | Shows the **Make a bid** button on `for_sale` games          |
| `admin`        | Sees everything + implies `canSeePrices` and `canBid`        |

## Covers (local cache, pluggable sources)

Game covers live in a **local cache** at `data/<note-id>/` (`cover.jpg` + a
`cover.json` metadata sidecar). The running app serves only from this cache
(`GET /covers/:id`) and **never depends on a remote**.

The cache is filled by an idempotent build-time tool (`src/covers/`):

```bash
bun run covers     # sync missing/upgradable covers (no creds needed for the common path)
task covers        # same, with .env injected from 1Password (enables id resolution)
```

Architecture (`src/covers/`):
- **`CoverProvider`** — a pluggable source. Built-in: `LudopediaProvider`
  (tier 30, full-res, public bucket) and `BggImageProvider` (tier 10, the
  `image/grid` fallback). Add a provider in `index.ts`; nothing else changes.
- **`CoverResolver`** — tries providers by descending tier, skips covers already
  cached at an equal/better tier (idempotent), **upgrades** when a better source
  becomes reachable, and falls back without ever downgrading a good cover.
- **`FsCoverStore`** — persists bytes + metadata (source, tier, sha256).
- A provider that's rate-limited raises `ProviderUnavailableError`, so the run
  **defers** that game (keeps any existing cover) and a later run retries it.

Run `bun run covers` before `docker build` (covers are baked into the image).

## Data source (baked into the image)

Games are parsed from the YAML frontmatter of the `.md` files in `INVENTORY_DIR`.
The image is **public and carries no data** — at runtime a `git-sync` sidecar
pulls the inventory repo into a volume and the app reads it from there (see the
`chart/`). Recognized fields: `id`, `name`, `language`, `type`, `expansion-of`,
`price`, `purchase/source`, `purchase/date`, `tags`, `bgg/url`, `bgg/id`,
`ludopedia/url`, `ludopedia/id`, `image/grid`. See `chart/examples/inventory/`
for the format.

For local dev, point `INVENTORY_DIR` at a folder of `.md` notes.

To list a game for sale, add to its frontmatter:

```yaml
for_sale: true
sale_price: "R$ 250,00"   # optional; falls back to `price`
```

## What's baked in vs. mounted

| Data | Default path | In image? | Override |
|------|--------------|-----------|----------|
| Inventory `.md` | `/app/inventory` | ✅ baked | mount over it, or set `INVENTORY_DIR` |
| Covers | `/app/data` | ✅ baked | set `COVERS_DIR` |
| Role config (`whitelist-config.yaml`) | `/app/whitelist-config.yaml` | ✅ baked default | mount a **ConfigMap**, or set `WHITELIST_CONFIG_PATH` |
| Users (`role:identifier=password` blob) | `/secrets/users` | ❌ **not baked** | mount a **Secret**, or set `WHITELIST_USERS_PATH` |
| `tmp-users.jsonl` (temp-user db) | `/data/tmp-users.jsonl` | writable dir created in image | mount a volume to persist across restarts |

User credentials are **never** baked into the image (excluded from the build
context too) — they come from a mounted Secret. The role config is baked as a
non-secret default and overridable by a ConfigMap. Only the temp-user store
needs writable storage.

## Run locally

```bash
bun install
cp whitelist-users.example.txt whitelist-users.txt   # local users (gitignored)
export AUTH_SECRET=$(openssl rand -hex 32)
bun run dev   # uses ./inventory, ./whitelist-config.yaml, ./whitelist-users.txt
```

The example users file ships with sample logins (`you@example.com` /
`admin-password`, etc.) — edit `whitelist-users.txt` for local use. In prod the
users come from a mounted Secret, never this file.

## Run with Docker (self-contained)

```bash
docker build -t board-games .
# Image bakes inventory + covers + role config; provide AUTH_SECRET, the users
# Secret, and (optionally) a writable volume for temp users:
docker run --rm -p 3000:3000 \
  -e AUTH_SECRET=$(openssl rand -hex 32) \
  -e WHATSAPP_NUMBER=5511999998888 \
  -v "$(pwd)/whitelist-users.txt:/secrets/users:ro" \
  -v board-games-tmpusers:/data \
  board-games
```

## Endpoints

| Route            | Purpose                                  |
|------------------|------------------------------------------|
| `GET /`          | Collection (or login page if signed out) |
| `POST /auth/login` | Verify email + password, set session cookie |
| `POST /admin/invite` | Admin-only: mint a temp-user invite link |
| `GET /auth/invite` | Redeem an invite link → temp session     |
| `GET /auth/logout` | Clear the session cookie               |
| `GET /healthz`   | Health check                             |
