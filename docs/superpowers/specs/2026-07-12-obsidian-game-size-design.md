# Obsidian Game Size Override

## Goal

Allow an Obsidian game note to give a shelf box physical front-face dimensions without changing the appearance of games that omit the property.

```yaml
site/size: 10x7cm
```

The dimensions are width × height. The measured shelf calibration is `30cm = 380px`, so the example renders at about `127px × 89px`.

## Data flow

`src/worker/parse.ts` validates `site/size` while flattening an Obsidian note. A valid value becomes an optional `{ widthCm, heightCm }` field on `Game` and in `catalog.json`. Both dimensions must be positive numbers; dot or comma decimals are accepted, the `cm` suffix is optional, and surrounding whitespace or uppercase `X`/`CM` are accepted. Invalid values are ignored, preserving existing rendering.

`src/views.tsx` converts declared centimeters using the fixed `380 / 30` pixels-per-centimeter calibration. A sized shelf box receives the converted width and its declared aspect ratio. The existing browser-side cover measurement skips sized boxes so the image cannot overwrite the explicit ratio.

Games without `site/size` remain `250px` wide and continue deriving their aspect ratio from the loaded cover exactly as they do today.

## Shelf behavior

The default shelf cell remains `250px` wide with a `380px` row height. The collection renderer calculates the largest declared box width and height among rendered base games:

- Values within the defaults do not alter the shelf grid.
- A width above `250px` expands the shared grid column width while unsized boxes remain `250px` wide and centered.
- A height above `380px` expands the shared shelf row height.

Using shared maximum dimensions preserves the repeating shelf background and prevents boxes from overlapping. Expansion dimensions do not affect the shelf because expansions are nested under their base game rather than rendered as separate boxes.

## Verification

One focused Bun test will verify:

1. `site/size: 10x7cm` parses to numeric centimeter dimensions.
2. Missing or invalid values leave the size undefined.
3. A sized game renders converted dimensions and is marked so cover measurement cannot replace its ratio.
4. An oversized declaration expands the shelf grid.
5. An unsized game retains the current default markup and sizing behavior.
