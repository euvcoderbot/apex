# The Linear look

The app's only look. `index.html` marks `<html data-skin="linear">`; every Linear rule is scoped to `:root[data-skin="linear"]` and lives in
`skins.css`, the last cascade layer (`skin`), drawn on top of the shared component layers. It works with both Light and Dark.

The full workspace redesign extends this foundation. See [research and interaction specification](linear-workspace-spec.md) for official product-documentation sources, layout decisions and verification. `linear-workspace.js` reparents existing navigation and lap actions, and supplies command search; it does not own data or calculations.

## Files

| File | Role |
| --- | --- |
| `skins.css` | Every Linear-look rule, plus the generated colour tokens between `<generated-skin-tokens>` markers. |
| `scripts/generate-skin.mjs` | Holds Linear's colour tokens and maps them onto the app's tokens. `--check` fails when `skins.css` is stale. |
| `skin.js` | The toggle: sets `data-skin`, updates the button state, re-measures segment thumbs, redraws canvas charts. |
| `session-state.js` (`canvasTheme`) | Canvas charts read `--chart-*` tokens when a look defines them. |
| `assets/fonts/inter/` | Inter Variable (latin, optical size axis), SIL Open Font License. Only downloaded when the Linear look is on. |
| `scripts/test-skin.mjs` | Generator is current, Linear's values used as published, contrast of every text and fill role, every rule opt-in, toggle state and persistence. |

## Sources (read 2026-11-05)

- Linear, "How we redesigned the Linear UI" (2024) and the 2026 refresh notes: themes generated from three variables (base, accent, contrast) in
  LCH; an inverted-L frame (sidebar and top bar on the canvas, the content raised as one panel); "structure should be felt, not seen"; quieter
  sidebar and fewer icons.
- linear.app/brand: Mercury White `#F4F5F8`, Nordic Gray `#222326` (monochrome wordmark accents) and the desaturated-blue brand colour.
- linear.app stylesheet: the full `--color-*` token set under `[data-theme="dark"]` and `[data-theme="light"]` (46 and 44 tokens), and
  the type, radii and transition timings listed below.
- Inter / Inter Display (rsms.me/inter): Linear's typefaces. The app ships Inter Variable with the optical-size axis, which gives Display
  shapes at large sizes.

The authenticated product app was not inspected. Its public embedded product demo, official documentation and design write-ups were inspected; the evidence matrix distinguishes measured public values from Apex-specific adaptations.

## What was taken, and how closely

| Area | Linear | Here |
| --- | --- | --- |
| Colour source | themes generated from base, accent, contrast | Linear's generated output is used directly: its published tokens are the palette in `SKINS.linear`. |
| Frame and panel | dark: frame `bg-level-0 #08090a`, panel `bg-panel #0f1011`; light: grey frame, white content | dark canvas `#08090a`, panel `#0f1011`; light canvas `bg-secondary #f9f8f9`, panel `#ffffff`. |
| Surface levels | `bg-level-2`, `bg-secondary`, `bg-tertiary`, `bg-quaternary` (`bg-quinary` light) | well, control, control hover, selected, in that order. |
| Text tiers | dark `#f7f8f8 #d0d6e0 #8a8f98 #62666d`; light `#282a30 #3c4149 #6f6e77 #86848d` | label, secondary, tertiary, quaternary, exactly. |
| Borders | translucent 5% and 8%; opaque `border-secondary` / `border-tertiary` | separator 5%, border 8%, strong border opaque. |
| Brand fill | dark `#5e6ad2`; light `#7070ff` | primary buttons, selected tiles, selection. Light darkened to `#6563f1` (3.85 → 4.5:1 with white text). |
| Accent text | dark `accent #7170ff`; light `link-primary #7070ff` | `--ui-accent`. Light darkened to `#5f5be8` for 4.5:1 on white. |
| Accent tint | `accent-tint` dark `#18182f`, light `#f1f1ff` | `--ui-selection-tint` (accent-on-tint buttons such as each driver's Fastest pick). |
| Neutral selection | white 8% / black 5% | list rows, toolbar pressed state, disabled. |
| Status | green `#27a644`, red `#eb5757`, yellow `#f0bf00` | deltas and warnings. Exact in dark; in light darkened to `#00811d`, `#cb383d`, `#946600` for 4.5:1. |
| Overlay | `overlay-primary` dark `#000000d9`, light `#ffffffa6` | the lap sheet's backdrop. |
| High contrast | Linear's contrast slider | under `prefers-contrast: more`, secondary to quaternary text move 40% toward the label and borders strengthen. |
| Type | Inter Variable 13 px body, weights 510 and 590 | same; ramp 11/12/13/14/15/20/24. |
| Radii | 4/6/8/12, pill 9999 | controls 6, cards 8, panel 12, chips pill. |
| Controls | 28 px, flat, hairline inset ring | same; primary actions in the accent. |
| Frame | location / view bar hierarchy, subdued navigation | persistent 208px workspace rail, 48px location bar, horizontal view filters, broad analysis area and contextual trailing inspector; responsive horizontal navigation on phones. |
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
- Issue-tracker commands and unrelated workflows; Apex's command dialog operates its existing analysis controls.

## Changing it

Edit the palette in `scripts/generate-skin.mjs` (re-read it from linear.app's stylesheet if Linear changes it), then run `node scripts/generate-skin.mjs` and `node --test scripts/test-skin.mjs`. The contrast
test fails if a change makes text or the primary action unreadable.
