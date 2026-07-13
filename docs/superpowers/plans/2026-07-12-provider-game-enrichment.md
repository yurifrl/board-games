# Provider Game Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cache complete BGG/Ludopedia game records, normalize useful facts into the catalog, and expose provider tabs and filters.

**Architecture:** A worker module owns provider fetching, disk snapshots, and fact normalization. `Game` carries the resulting provider snapshots and normalized facts; existing SSR and client-side filtering consume them without a database or new dependency.

**Tech Stack:** Bun, TypeScript, Hono JSX, Node filesystem APIs, existing CSS and inline browser JavaScript.

## Global Constraints

- Enrich only games with explicit provider IDs.
- Run enrichment every worker cycle and reuse snapshots for 24 hours.
- A changed provider ID must fetch immediately.
- Preserve stale snapshots when a provider refresh fails.
- Add no dependency and do not overwrite unrelated uncommitted work.

---

### Task 1: Provider snapshot cache and normalization

**Files:**
- Create: `src/worker/provider-data.ts`
- Test: `src/worker/provider-data.test.ts`

**Interfaces:**
- Produces: `enrichProviderData(games, options): Promise<void>`, `ProviderSnapshot`, and `ProviderFacts`.
- Consumes: explicit `Game.bggId`, `Game.ludopediaId`, `DATA_DIR`, provider bearer tokens, and an injectable `fetch`/clock for tests.

- [ ] Write tests proving fresh snapshots avoid HTTP, changed IDs fetch a different cache path, stale refresh failures preserve data, and BGG/Ludopedia payloads normalize requested facts.
- [ ] Run `bun test src/worker/provider-data.test.ts` and confirm failures are caused by the missing module.
- [ ] Implement filesystem snapshots, official provider requests, XML/JSON normalization, and stale fallback with no new package.
- [ ] Run `bun test src/worker/provider-data.test.ts` and confirm it passes.

### Task 2: Worker and catalog integration

**Files:**
- Modify: `src/games.ts`
- Modify: `src/worker/index.ts`

**Interfaces:**
- Consumes: `enrichProviderData` from Task 1.
- Produces: catalog games with `facts` and `providerData` before tinting and atomic catalog write.

- [ ] Extend the test fixture compilation path through Task 1 tests to require the new `Game` fields.
- [ ] Add the provider enrichment call after Obsidian parsing and before `writeCatalog`, passing existing provider credentials.
- [ ] Run `bun test src/worker/provider-data.test.ts src/games.test.ts` and confirm it passes.

### Task 3: Provider tabs, media dump, and filters

**Files:**
- Modify: `src/collection-filter.test.ts`
- Modify: `src/views.tsx`
- Modify: `src/public/styles.css`

**Interfaces:**
- Consumes: `Game.facts` and `Game.providerData`.
- Produces: BGG/Ludopedia/Files tabs and filter controls/data attributes for players, complexity, rating, year, mechanics, categories, designers, publishers, and language dependency.

- [ ] Add rendering assertions for provider tabs, escaped full payloads, media links, normalized data attributes, and all requested filter controls.
- [ ] Run `bun test src/collection-filter.test.ts` and confirm the new assertions fail.
- [ ] Add minimal Hono JSX provider panes, URL extraction, data attributes, filter choices, and client matching logic; add only the CSS required by these panes.
- [ ] Run `bun test src/collection-filter.test.ts` and confirm it passes.

### Task 4: Full verification

**Files:**
- Modify only files required to fix failures introduced by Tasks 1–3.

- [ ] Run `bun test`.
- [ ] Run `bunx tsc --noEmit` if a TypeScript configuration exists; otherwise run `bun test` as the repository's executable type/behavior gate.
- [ ] Run `git diff --check` and inspect `git diff --stat` to ensure unrelated user changes remain intact.
- [ ] Update bead `board-games-bti` with implementation and verification status; do not commit, push, or sync without explicit authority.
