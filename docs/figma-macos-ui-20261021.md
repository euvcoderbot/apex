# F1 Apex Data — Figma macOS UI system

Design file: https://www.figma.com/design/32fieprdLFtiUcUSq0yU6z

The `F1 Apex data` Figma team contains the editable design system and screen layouts. The file has 25 shared control/content families, 160 variants, 125 variables, six typography styles, three effect styles, and source SVG icon components. It includes the session workspace and all eight car-performance categories in light and dark, mobile layouts for all nine views, tablet layouts for both workspaces, and feedback/menu/dialog examples.

The semantic colors and geometry are recorded in `design/tokens.json`. `design/components.json` maps each production `data-ui-kind` control role to its Figma component. The application uses classic HTML and JavaScript with shared CSS rather than React Code Connect components. These JSON files ship with the component catalogue at `/apex/ui-catalog.html`.

## Implementation

The existing `components` and `window` cascade layers remain the appearance owners. Shared colors, 30 px regular controls, 60 px toolbar, 16 px content radii, spacing, table typography, transient materials, selection, feedback and dialog styles apply to dynamically generated content as well as the initial HTML. Chart and table content uses solid surfaces; material is reserved for navigation and transient UI. Team colors and measured values retain their existing source and rendering logic.

Apple system typography remains first on Macs. Although Figma listed SF Pro, this connection rendered it blank, so the editable Figma file uses Inter. A self-hosted, OFL-licensed Inter variable font provides the corresponding web fallback. The macOS 27 kit was discoverable but its component imports were denied; local components were created with variable bindings and explicit appearance variants. Starter's one-mode limit is handled without a paid upgrade.

Figma preview values illustrate layout; they are not an alternate measurement dataset. The temporary complete-page capture was removed after its discrete app-icon asset was transferred. Screens consist of editable text, component instances, vector icons and data plots.

## Verification

- The full existing JavaScript suite passed (251 tests). The density assertion now reflects the shared 30 px control token.
- The production Worker build passed with the existing R2 configuration.
- All eight performance categories were checked at 1440, 768 and 390 px; no page overflow or unassigned controls was found.
- Singapore qualifying loaded, both drivers' fastest laps compared, and the session menu retained the selected value.
- Populated pace, cornering, tyre and results views, along with unavailable/loading states, were reviewed. Table notes now wrap inside their columns, and sector deltas/time values wrap rather than overlap.
- Figma text uses the verified Inter family without missing fonts. The final views use editable layers; the only raster content is the discrete app icon.

No telemetry, ranking, eligibility, scientific calculation or source-selection logic changed. Generated cache metadata is rebuilt by the existing synchronization step.
