# Filter Design Lab

## Goal

Create one standalone interactive HTML comparison lab for the board-game collection filters. It must make six responsive designs easy to compare using the same sample collection and filter behavior.

## Structure

`filter-design-lab.html` contains all markup, CSS, sample data, and JavaScript. A top comparison bar switches design variants and desktop/mobile preview width. No build step or dependencies are required.

## Variants

1. Quick chips: common filters stay visible above the collection.
2. Persistent sidebar: desktop facets remain beside results and collapse on mobile.
3. Bottom sheet: a compact toolbar opens a mobile-first sheet. Each high-cardinality filter group, such as Mechanic, Designer, or Publisher, shows its own local search immediately without an accordion. Options appear immediately as compact wrapping bubbles inside a fixed-height scroll block with a visible styled scrollbar, and typing filters that block in place while preserving an existing selection. There is no combined cross-filter search.
4. Compact popovers: each facet opens independently from the toolbar.
5. Command palette: one searchable overlay finds and toggles filter values.
6. Guided finder: filters are presented as a short sequence of plain-language choices.

## Shared Behavior

Every variant uses the same game data and state. Search, sorting, and filters update visible cards, active chips, result count, and unavailable options immediately. Sorting is integrated at the top of the filter sheet in a visually distinct card labeled “Sort · Changes result order.” A divider introduces a separate “Filters · Narrows results” zone below it. Users can remove one active filter or clear all. Overlay variants close through their close control, backdrop, or Escape.

## Responsive Behavior

The preview offers desktop and mobile widths. On desktop, the filter dialog is centered horizontally, starts just below its opener, and uses the remaining viewport height. On narrow screens it becomes a bottom sheet.

## Accessibility

Use native buttons, inputs, fieldsets, labels, and dialogs where applicable. Preserve visible focus styles, keyboard operation, live result counts, and readable contrast.

## Verification

Open the HTML directly in a browser. Confirm all six variants switch correctly, desktop/mobile previews resize, filter state updates results, clear actions reset state, and overlays close with Escape.
