# Visual refinement after version 213

Version 213 concentrated on interaction, loading and accessibility corrections. It did not deliver the substantial visual
refinement requested in the brief. This follow-up changes the visible composition and includes before/after evidence.

The authenticated measurements in `linear-design-spec.md` remain the reference. Chart arrangements are Apex adaptations
of those principles, not claims that Linear contains equivalent F1 charts. No numerical calculations or data files change.

## Visible changes

| Family | Result |
| --- | --- |
| Ranked and diverging comparisons | Names and exact values share a baseline. Six-pixel tracks use the card's full width underneath, instead of being squeezed between fixed label/value columns. Secondary seconds remain readable. |
| Chart/table pairs | Retain their compact variant and measured row alignment, with flexible columns on narrow screens. |
| Performance toolbar | The folded race selection becomes an inline count and Change action. Expanded selection retains its controls. The style conflict that exposed its hidden action row is removed. |
| Performance headings | Reduce excess space before charts and between chart titles and controls. |
| Season titles | Identify the selected page, with year and saved-data metadata arranged separately. |
| Standings | Primary championship table starts beside the title fight and trend charts, rather than below a full-width summary card. Small layouts stack the title fight before the table. |
| Mobile standings | Points stay visible at the right edge while secondary statistics scroll inside the table. |
| Season tables | Table sections use the page surface and quiet headings. Chart widgets retain their card surface. |
| Results summaries | Eight separate dashboard cards become a flat grid of property cells with shared alignment. |
| Season comparisons | Use the same label/value baseline and full-width track anatomy. |
| Session overview | Five boxed metrics become one flat property strip. A container query switches to two columns when the analysis column is narrow, with the last metric spanning the row. |

The old 26 px ranked-row rule and duplicate paired-row height declaration were removed. Changes modify the existing
owners in `skins.css` and `season.css`; no skin, cascade layer, dependency, or competing token block was introduced.

## Before and after

All pairs use the same recorded data and viewport. These images demonstrate visual differences; token-audit counts alone
do not establish design quality.

| View | Before | After |
| --- | --- | --- |
| Pace, desktop | [Before](visual-review/cars-pace-before.png) | [After](visual-review/cars-pace-after.png) |
| Pace, phone | [Before](visual-review/cars-pace-phone-before.png) | [After](visual-review/cars-pace-phone-after.png) |
| Standings | [Before](visual-review/season-standings-before.png) | [After](visual-review/season-standings-after.png) |
| Standings, phone | — | [Visible Points column](visual-review/season-standings-phone-after.png) |
| Loaded Session | [Before](visual-review/session-loaded-before.png) | [After](visual-review/session-loaded-after.png) |

## Verification

- 114 expanded/scrolled renders cover the changed route families in both themes at 1440, 1024 and 390 px, with no property findings.
- Twenty final representative captures review Session, Pace, Tyres, Standings and Results. They exposed one off-token light-theme
  inspector label; the shared disclosure recipe was corrected and four subsequent Tyres renders have no findings.
- Twenty-four chart interaction cases pass across Chromium, WebKit and Firefox. Twenty-four final layout cases pass across the
  same browsers, checking track width, label/value clearance, folded/expanded selection and the primary Standings column.
- Twelve additional Standings cases verify the final mobile Points column across all three browsers.
- All 33 selected functional, responsive, accessibility, loading, sorting and telemetry checks pass in Chromium, including the
  six complete route matrices. All 32 reviewed performance screenshot cases pass in Chromium/WebKit; their baselines are refreshed
  for the intentional new composition, toolbar and bar geometry.
- 427 unit tests pass, with four existing skips. Type checking and lint pass.
- Seven unchanged catalogue screenshot cases pass (one unsupported WebKit emulation case skipped). The twelve shell snapshots
  were reviewed and refreshed for the small vertical shift introduced by the shared heading spacing; all twelve pass.

The signed-in Linear session was not available for a fresh inspection. Existing measured app values remain authoritative;
light-theme reference values are published approximations. Scrolled viewport screenshots provide lower-page coverage because
WebKit full-height element captures can include the fixed workspace mask. Firefox tests use fixed contexts for the known
runtime-resize limitation. Data fixtures represent supported route states, not every race/driver/filter permutation.
