# The Linear look

A second look for the app, switched with the toolbar button beside Light/Dark (`#skinToggle`). The default macOS look is unchanged: every rule
for the Linear look is scoped to `:root[data-skin="linear"]` and lives in `skins.css`, the last cascade layer (`skin`). The choice is stored in
this browser (`localStorage['apex-skin']`) and applied by an inline script in `index.html` before the first paint. It works with both Light and Dark.

## Files

| File | Role |
| --- | --- |
| `skins.css` | Every Linear-look rule, plus the generated colour tokens between `<generated-skin-tokens>` markers. |
| `scripts/generate-skin.mjs` | Generates the colour tokens from three inputs per theme. `--check` fails when `skins.css` is stale. |
| `skin.js` | The toggle: sets `data-skin`, updates the button state, re-measures segment thumbs, redraws canvas charts. |
| `session-state.js` (`canvasTheme`) | Canvas charts read `--chart-*` tokens when a look defines them. |
| `assets/fonts/inter/` | Inter Variable (latin, optical size axis), SIL Open Font License. Only downloaded when the Linear look is on. |
| `scripts/test-skin.mjs` | Generator is current, contrast of generated colours, every rule opt-in, toggle state and persistence. |

## Sources (read 2026-11-05)

- Linear, "How we redesigned the Linear UI" (2024) and the 2026 refresh notes: themes generated from three variables (base, accent, contrast) in
  LCH; an inverted-L frame (sidebar and top bar on the canvas, the content raised as one panel); "structure should be felt, not seen"; quieter
  sidebar and fewer icons.
- linear.app computed styles: colours, type, radii and transition timings listed below were measured from the public site.
- Inter / Inter Display (rsms.me/inter): Linear's typefaces. The app ships Inter Variable with the optical-size axis, which gives Display
  shapes at large sizes.

Linear's product app sits behind a sign-in and was not inspected; values come from the public site and Linear's own write-ups.

## What was taken, and how closely

| Area | Linear | Here |
| --- | --- | --- |
| Theme method | base + accent + contrast in LCH | Same three inputs in OKLCH (`SKINS.linear`); high-contrast theme = contrast 100 under `prefers-contrast: more`. |
| Dark surfaces | bg `#08090a`, panel `#0f1011`, controls `#1c1c1f`–`#28282c` | canvas `#0a0b0c`, panel `#0f0f11`, controls from the same lightness steps. |
| Light surfaces | `#ffffff`, `#f9f8f9`, `#f4f2f4` | generated from base L .999. |
| Text | `#f7f8f8`, `#d0d6e0`, `#8a8f98`, `#62666d` | four generated steps; the test holds the label at 7:1 and the second and third at 4.5:1 (the fourth, for hints, is about 3.6:1). |
| Accent | indigo `#5e6ad2` | action `#636bc6` dark / `#5b61ce` light (white text at 4.7:1 and 5.2:1). |
| Type | Inter Variable 13 px body, weights 510 and 590 | same; ramp 11/12/13/14/15/20/24. |
| Radii | 4/6/8/12, pill 9999 | controls 6, cards 8, panel 12, chips pill. |
| Controls | 28 px, flat, hairline inset ring | same; primary actions in the accent. |
| Selection in lists | grey, not the accent | `--ui-list-selected` (white 7%). |
| Frame | inverted L, content raised | at 980 px and wider the content and inspector sit on one raised panel; the sidebar and top bar stay on the canvas. |
| Materials | no glass | blur, glint and press scaling are off. |

## Motion

| Element | Linear | Here |
| --- | --- | --- |
| Hover | in 0 s, out 0.15 s | same (`--lin-hover-out`). |
| Menus | scale 0.9 + fade, 100 ms, ease-out-quad | `lin-menu-in`, `--lin-menu`. |
| Tooltips | scale 0.9 + fade, 120 ms | `lin-tooltip-in`, `--lin-tooltip`. |
| Dialog (lap sheet) | scale 0.96 + fade, 175 ms; overlay fade 175 ms | `lin-dialog-in` on `#lapSelectionBody:popover-open`, `lin-fade-in` on its backdrop. |
| Easing | ease-out-quad `cubic-bezier(.25,.46,.45,.94)` | `--lin-ease-out-quad`. |

All of it is turned off under `prefers-reduced-motion: reduce`.

## Not copied

- Linear's logo, wordmark, illustrations and marketing layouts.
- Exit animations for menus and the sheet: the app removes them from the page on close, so only the entrance animates.
- Linear's command menu and keyboard model; the app keeps its own controls.

## Changing it

Edit the inputs in `scripts/generate-skin.mjs`, then run `node scripts/generate-skin.mjs` and `node --test scripts/test-skin.mjs`. The contrast
test fails if a change makes text or the primary action unreadable.
