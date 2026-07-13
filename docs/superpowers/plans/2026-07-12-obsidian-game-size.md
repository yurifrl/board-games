# Obsidian Game Size Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render optional Obsidian `site/size: WIDTHxHEIGHTcm` dimensions while leaving every unsized shelf box unchanged.

**Architecture:** Parse the optional value once in the worker and persist numeric centimeters on `Game`. Server rendering converts centimeters with the measured `30cm = 380px` calibration, adds dimensions only to sized boxes, and expands the shared grid only beyond its current `250px × 380px` cell.

**Tech Stack:** Bun, TypeScript, Hono JSX, CSS Grid, `bun:test`

## Global Constraints

- Accept `site/size: WIDTHxHEIGHT` with dot or comma decimals and an optional `cm` suffix, including surrounding whitespace, uppercase `X`, and uppercase `CM`.
- Both dimensions must be positive; invalid values are ignored.
- Keep unsized games at the existing `250px` width with browser-derived cover aspect ratio.
- Keep the existing shelf defaults: `30cm = 380px`, `250px` columns, and `380px` rows.
- Expand columns or rows only when a declared box exceeds the corresponding default.
- Add no dependencies or new runtime files.
- Do not commit without explicit authorization; this workspace already contains unrelated uncommitted changes.

---

### Task 1: Parse and render physical game dimensions

**Files:**
- Modify: `src/games.ts:5-31`
- Modify: `src/worker/parse.ts:23-31,76-105`
- Modify: `src/views.tsx:89-120,377-405`
- Modify: `src/public/styles.css:57-77`
- Test: `src/collection-filter.test.ts:1-65`
- Modify: `README.md:87-100`

**Interfaces:**
- Produces: `Game.siteSize?: { widthCm: number; heightCm: number }`
- Consumes: Obsidian frontmatter key `site/size`
- Produces: shelf boxes marked with class `sized`, inline converted width/aspect ratio, and optional shelf `--colw`/`--rowh` overrides

- [ ] **Step 1: Write failing parser and renderer tests**

Extend `src/collection-filter.test.ts` with focused cases equivalent to:

```ts
test("reads physical shelf size from Obsidian frontmatter", () => {
  const parsed = parseGameNote("---\nid: sized-game\nname: Sized Game\nsite/size: 10x7cm\n---");
  expect(parsed?.siteSize).toEqual({ widthCm: 10, heightCm: 7 });

  const invalid = parseGameNote("---\nid: sized-game\nname: Sized Game\nsite/size: 0x7cm\n---");
  expect(invalid?.siteSize).toBeUndefined();
});

test("renders declared dimensions and expands only oversized shelves", () => {
  const sized = { ...game, siteSize: { widthCm: 10, heightCm: 7 } };
  const oversized = { ...game, id: "large", siteSize: { widthCm: 25, heightCm: 35 } };

  const sizedHtml = render([sized]);
  expect(sizedHtml).toContain('class="box sized"');
  expect(sizedHtml).toContain("width:126.67px;aspect-ratio:10/7");

  const oversizedHtml = render([oversized]);
  expect(oversizedHtml).toContain("--colw:316.67px;--rowh:443.33px");

  const defaultHtml = render([game]);
  expect(defaultHtml).not.toContain('class="box sized"');
  expect(defaultHtml).not.toContain("--colw:");
});
```

Extract only a local test helper `render(games: Game[])` if needed to avoid repeating the existing `collectionPage` options; do not add production abstractions for tests.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
bun test src/collection-filter.test.ts
```

Expected: failures because `Game.siteSize`, parsing, sized markup, and shelf variables do not exist.

- [ ] **Step 3: Add the catalog field and minimal parser**

Add to `Game` in `src/games.ts`:

```ts
siteSize?: { widthCm: number; heightCm: number };
```

Add a parser beside `positiveNumber` in `src/worker/parse.ts`:

```ts
function siteSize(v: unknown): Game["siteSize"] {
  const match = str(v)?.trim().match(/^(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)(?:\s*cm)?$/i);
  if (!match) return undefined;
  const widthCm = positiveNumber(match[1].replace(",", "."));
  const heightCm = positiveNumber(match[2].replace(",", "."));
  return widthCm && heightCm ? { widthCm, heightCm } : undefined;
}
```

Map it in `mapGame`:

```ts
siteSize: siteSize(fm["site/size"]),
```

- [ ] **Step 4: Render sized boxes and dynamic shelf cells**

In `src/views.tsx`, use these constants and conversion:

```ts
const SHELF_HEIGHT_PX = 380;
const SHELF_HEIGHT_CM = 30;
const BOX_WIDTH_PX = 250;
const cmToPx = (cm: number) => Math.round(cm * SHELF_HEIGHT_PX / SHELF_HEIGHT_CM * 100) / 100;
```

For `Box`, append `sized` only when `g.siteSize` exists and append inline sizing after `--tint`:

```ts
const size = g.siteSize;
const sizeStyle = size ? `;width:${cmToPx(size.widthCm)}px;aspect-ratio:${size.widthCm}/${size.heightCm}` : "";

class={`box${size ? " sized" : ""}`}
style={`--tint:${tint}${sizeStyle}`}
```

Before rendering `.shelf`, calculate only from rendered base games:

```ts
const sized = groups.flatMap(({ base }) => base.siteSize ? [base.siteSize] : []);
const colw = Math.max(BOX_WIDTH_PX, ...sized.map(({ widthCm }) => cmToPx(widthCm)));
const rowh = Math.max(SHELF_HEIGHT_PX, ...sized.map(({ heightCm }) => cmToPx(heightCm)));
const shelfStyle = colw > BOX_WIDTH_PX || rowh > SHELF_HEIGHT_PX
  ? `--colw:${colw}px;--rowh:${rowh}px`
  : undefined;
```

Render:

```tsx
<div class="shelf" style={shelfStyle}>{groups.map((grp) => <Box grp={grp} perm={perm} />)}</div>
```

Change the cover measurement script to preserve declared dimensions:

```js
boxes.forEach(function(b){if(b.classList.contains('sized'))return;var i=b.querySelector('img');if(!i)return;var size=function(){if(i.naturalWidth)b.style.aspectRatio=i.naturalWidth+'/'+i.naturalHeight;};i.complete?size():i.addEventListener('load',size);});
```

- [ ] **Step 5: Keep default boxes fixed while allowing wider cells**

Update the shelf declarations in `src/public/styles.css`:

```css
.shelf {
  --colw: 250px;
  --rowh: 380px;
  grid-template-columns: repeat(auto-fill, var(--colw));
}
.box {
  width: 250px;
  justify-self: center;
}
```

Leave all other shelf geometry unchanged. Inline width wins for `.sized`; unsized boxes remain `250px` even when another game expands the grid column.

- [ ] **Step 6: Document the frontmatter field**

Add `site/size` to the recognized inventory fields in `README.md` and include one sentence/example:

```yaml
site/size: 10x7cm # optional front-face width × height; shelf calibration is 30cm
```

- [ ] **Step 7: Run focused and full verification**

Run:

```bash
bun test src/collection-filter.test.ts
bun test
bunx tsc --noEmit
```

Expected: all tests pass and TypeScript exits successfully.

- [ ] **Step 8: Inspect only the intended diff and report status**

Run:

```bash
git diff --check
git diff -- src/games.ts src/worker/parse.ts src/views.tsx src/public/styles.css src/collection-filter.test.ts README.md
git status --short
```

Expected: no whitespace errors; the feature changes coexist with the pre-existing uncommitted work. Do not commit until the user explicitly authorizes it.
