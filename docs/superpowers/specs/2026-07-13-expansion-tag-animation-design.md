# Expansion Tag Animation Design

## Goal

Make shelf games with expansions visually distinct and reveal their expansion names as thematic labels falling from the base game's brass name tag.

## Interaction

- A game with expansions shows a small `+` on its brass name tag.
- Mouse hover and keyboard focus raise the game box and reveal the expansion labels in sequence.
- On touchscreens, labels reveal automatically while the game crosses the center of the viewport and retract after it leaves.
- Tapping or clicking the base label or any expansion label opens the existing base-game detail view immediately.
- Reduced-motion users see the labels without falling animation.

## Presentation

Expansion labels use the same brass holder treatment as the base label, but are narrower and slightly staggered with alternating angles so they read as loose physical tags. They originate below the base name tag rather than from the game box. The current catalog has at most three expansions per base game, so the existing shelf presentation only needs to accommodate that real maximum.

## Implementation

Render expansion label spans inside the existing `Box` anchor in `src/views.tsx`. This preserves the current navigation target without nested links or extra click handling. Add expansion-state and transition styles to `src/public/styles.css`.

CSS handles hover, focus, active-state animation, staggering, and reduced motion. The existing inline collection script uses native `IntersectionObserver` on touch-capable layouts to toggle the active class for cards crossing a centered viewport band. No dependency or new abstraction is needed.

## Verification

Add a focused collection render test confirming that a grouped game emits the `+` marker and every expansion name within the same base-game link. Run the relevant Bun tests and confirm hover, keyboard focus, touch scrolling, immediate tap navigation, and reduced-motion behavior in the browser.
