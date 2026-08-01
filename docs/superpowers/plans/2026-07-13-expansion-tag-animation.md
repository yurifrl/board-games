# Expansion Tag Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reveal thematic expansion-name tags from shelf game labels on hover, focus, and touch scrolling.

**Architecture:** Extend the existing `Box` anchor with a label wrapper, plus marker, and decorative expansion spans. CSS owns presentation and motion; the existing inline collection script uses native `IntersectionObserver` to toggle the same active state on touch devices.

**Tech Stack:** Hono JSX, CSS, browser `IntersectionObserver`, Bun tests

## Global Constraints

- Every expansion label remains inside the base game's existing anchor and opens the same detail view.
- Use a `+` marker, matching brass labels, no new dependency, and no new abstraction.
- Respect `prefers-reduced-motion`.
- Do not alter unrelated uncommitted work or commit without explicit authorization.

---

### Task 1: Expansion label interaction

**Files:**
- Modify: `src/collection-filter.test.ts`
- Modify: `src/views.tsx`
- Modify: `src/public/styles.css`

**Interfaces:**
- Consumes: `Box` receives the existing `GameGroup` with `grp.expansions`.
- Produces: `.has-expansions`, `.expansion-mark`, `.expansion-tags`, `.expansion-tag`, and `.exp-active` presentation hooks.

- [ ] **Step 1: Write the failing render test**

Add a test that renders one base and two expansions, then asserts one shared `href="#g-ark-nova"`, the `has-expansions` class, `expansion-mark`, both expansion names, `IntersectionObserver`, centered `rootMargin`, and the reduced-motion CSS rule.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `bun test src/collection-filter.test.ts`

Expected: FAIL because the expansion shelf markup and observer do not exist.

- [ ] **Step 3: Add minimal JSX markup**

In `Box`, add `has-expansions` only when `grp.expansions.length > 0`. Replace the standalone shelf name span with a `.box-labels` wrapper containing the existing `.box-name`, a `+` marker with an accessible expansion count, and decorative `.expansion-tag` spans for `grp.expansions`.

- [ ] **Step 4: Add minimal CSS motion**

Move shelf-label positioning to `.box-labels`, preserve the existing brass `.box-name`, and style narrower brass expansion labels below it. Reveal them with staggered transforms for `.box:hover`, `.box:focus-visible`, and `.box.exp-active`; raise `.box3d`; raise the active card stacking order; disable transition and animation under `prefers-reduced-motion`.

- [ ] **Step 5: Add touch viewport activation**

In the existing collection script, when `matchMedia('(hover: none), (pointer: coarse)')` matches, observe only `.has-expansions` boxes with `rootMargin: '-35% 0px -35% 0px'` and toggle `.exp-active` from `entry.isIntersecting`.

- [ ] **Step 6: Run focused and full verification**

Run: `bun test src/collection-filter.test.ts`

Expected: PASS.

Run: `bun test src`

Expected: all tests PASS.

Run: `bunx tsc --noEmit`

Expected: exit 0 with no diagnostics.

- [ ] **Step 7: Inspect the final diff and repository state**

Run: `git diff -- src/views.tsx src/public/styles.css src/collection-filter.test.ts && git status --short`

Expected: only the requested feature appears in these files; pre-existing unrelated changes remain untouched. Do not commit without explicit authorization.
