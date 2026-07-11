# 3D Box Collection — Design

Date: 2026-07-11

## Goal

Replace the flat 2D grid with a browse experience where each game is a
physical **board-game box** (tray + lid) rendered in CSS 3D. The point is the
*joy of wandering box to box* — not commerce. Sale/bid stays a side feature.

Reference feel:
- [Nike SNKRS](https://mobbin.com/screens/81d4d6ec-03cd-4f81-9b3c-63be6a239a9d) — product as hero on a color-matched stage.
- [GOAT](https://mobbin.com/screens/fcfcd85a-3191-4e0e-b0cb-02ac3f076210) — full-screen detail with a translucent info panel over the hero.

## Constraints (the lazy spine)

- Pure CSS 3D transforms. **No WebGL, no Three.js, no animation library.**
- Reuse the cover images already loaded (`coverSrc` in `src/views.tsx`).
- Color extraction reuses `sharp` (already a dependency). No new deps.
- Stays server-rendered Hono/JSX + one CSS file, exactly like today.

## 1. The box (geometry)

Each box is ~5 stacked divs using `transform-style: preserve-3d`, shown at a
slight 3/4 angle. Visible faces:

- **lid top** = the cover art (the existing `<img>`).
- **lid front edge + one side edge** = thin colored bands = the box depth.
- **tray** sits under the lid, revealed only when opened.

A board-game box is two pieces: lid slightly larger than the tray, resting on
top. The closed box shows the lid; the open box shows the lid lifted off and
the tray beneath.

### Box models (3–4, alternated by `index % N`)

Differ only in proportions + edge thickness, as CSS classes:
- `box--deep` — big square, thick (Gloomhaven-ish)
- `box--flat` — wide and shallow
- `box--tall` — tall and thin
- `box--small` — small square

## 2. Color match (the tint)

When a cover is cached, compute its **dominant color** once with `sharp` and
store the hex on the game record in the catalog. At render time that hex
becomes a CSS custom property per box (`--tint`) that colors:
- the box side/front edges
- a soft glow/stage behind the box

Zero runtime cost; computed at cache time, read from the catalog on SSR.

Fallback: if no color is stored (old cache), default `--tint` to a neutral.

## 3. Motion (scroll)

Boxes tilt/parallax a few degrees as they cross the viewport, via native CSS
scroll-driven animations (`animation-timeline: view()`). No JS.

`ponytail:` native scroll-driven animations only; add a small rAF fallback
only if a target browser lacks support.

## 4. Open (tap → detail)

Tap a box:
1. Lid lifts and tilts off the tray (CSS keyframe on the lid faces).
2. Translucent detail page fades in — the *opened* box (lid off, tray showing)
   sits behind a GOAT-style translucent info panel (name, tags, price/bid when
   permitted, links, expansions).

Back = lid drops back onto the tray and the detail fades out.

Detail content is the same data the current `FeedCard` shows
(`src/views.tsx`) — reused, just re-skinned.

## Scope decisions

- **Replaces the grid.** The 3D box shelf is the browse view.
- The existing full-screen vertical "feed" toggle: dropped unless it earns its
  keep after the boxes exist. (Decide during implementation, not now.)
- Auth, invite, sale/bid logic, asset pipeline: **unchanged.**

## Files touched (expected)

- `src/public/styles.css` — box geometry, models, tint, scroll motion, open animation.
- `src/views.tsx` — box markup replacing `GridTile`; detail overlay.
- Cover caching path (`src/covers/*` and/or `src/games.ts`) — store dominant color.
- Possibly a small client script for the open/close toggle (kept inline, like `VIEW_SCRIPT`).

## Out of scope

Physics, real lighting, WebGL, new dependencies, backend/auth changes.
