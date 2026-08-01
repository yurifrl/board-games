# Filter Design Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one standalone interactive HTML lab comparing six responsive board-game filter designs.

**Architecture:** Keep sample data, rendering, filter state, and all six visual variants in one dependency-free file. Variant controls change presentation while the same state and result cards make comparisons fair.

**Tech Stack:** HTML, CSS, browser JavaScript

## Global Constraints

- Create exactly one standalone `filter-design-lab.html` implementation file.
- Include six switchable responsive variants and desktop/mobile preview controls.
- Use native accessible controls and no dependencies or build step.

---

### Task 1: Build and verify the comparison lab

**Files:**
- Create: `filter-design-lab.html`

**Interfaces:**
- Consumes: browser DOM APIs and embedded `games` sample data.
- Produces: `setVariant(name)`, `setPreview(size)`, `setFilter(key, value)`, `clearFilters()`, `render()`.

- [ ] **Step 1: Add a failing structural check**

Run before creating the file:

```bash
test -f filter-design-lab.html && grep -q 'data-variant="guided"' filter-design-lab.html
```

Expected: FAIL because `filter-design-lab.html` does not exist.

- [ ] **Step 2: Create the standalone implementation**

Create semantic controls for the six variants (`chips`, `sidebar`, `sheet`, `popovers`, `command`, `guided`), desktop/mobile preview buttons, result count, active filters, and game cards. Embed CSS for the collection theme and responsive presentations. Embed sample game objects and implement the produced functions so every control updates shared state and re-renders results.

```js
const state = { variant: "chips", preview: "desktop", query: "", filters: {} };
function setVariant(name) { state.variant = name; render(); }
function setPreview(size) { state.preview = size; render(); }
function setFilter(key, value) { value ? state.filters[key] = value : delete state.filters[key]; render(); }
function clearFilters() { state.query = ""; state.filters = {}; render(); }
```

- [ ] **Step 3: Run structural checks**

```bash
for id in chips sidebar sheet popovers command guided; do grep -q "data-variant=\"$id\"" filter-design-lab.html; done
grep -q 'setPreview' filter-design-lab.html
grep -q 'aria-live="polite"' filter-design-lab.html
```

Expected: all commands exit successfully.

- [ ] **Step 4: Run browser JavaScript syntax check**

```bash
bun -e 'const h=await Bun.file("filter-design-lab.html").text(); const js=h.match(/<script>([\s\S]*)<\/script>/)[1]; new Function(js); console.log("ok")'
```

Expected: `ok`.

- [ ] **Step 5: Review responsive behavior manually**

Open `filter-design-lab.html`, switch through all six variants, toggle desktop/mobile, select and clear filters, and verify the visible cards and result count update.
