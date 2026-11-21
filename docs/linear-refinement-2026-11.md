# Linear refinement: November 2026

Source baseline: `208d8866a062cd8e082909e63bb56ade0a096a3b`. Work is isolated on `codex/linear-refinement`.

Scope correction: this checkpoint mostly improved behavior and smaller styling issues. It was subsequently published as
version 213, after the temporary Sites access block cleared. The substantive visual follow-up and before/after evidence
are documented in [linear-visual-refinement.md](linear-visual-refinement.md).

## Reference and scope

`linear-design-spec.md` remains authoritative: authenticated-app measurements from November 10 override the older marketing studies. The older research documents now explicitly identify their values as historical. Linear's current public [UI redesign article](https://linear.app/now/how-we-redesigned-the-linear-ui) and [Insights documentation](https://linear.app/docs/insights) were also consulted. No authenticated Linear browser session is currently connected. Telemetry styling is an Apex adaptation, not a verified Linear chart specification.

The browser inventory includes Session analysis (empty, compared laps, lap sheet, compute settings, explanations), all eight Car performance categories and its empty state, all seven Season tabs, the three power-unit groupings, and the component catalogue. These are 24 states at 1440, 1024 and 390 pixels in both themes. Captures now include vertical scroll positions and the right edge of overflowing tables. This is broader than the earlier top-of-viewport screenshot coverage.

## Findings and implemented refinements

| Finding | Refinement | Owner |
| --- | --- | --- |
| Default power-unit sorting was invisible; first activation repeated its existing order | Register the effective default sort and expose it through `aria-sort`; the first activation reverses it | `season.js` |
| Sorting used focusable table headings and lost keyboard position during rendering | Native buttons inside column headers, explicit accessible names, focus restored after repaint | `season.js`, `skins.css` |
| Reliability headings collided at desktop widths | Wrapping labels, reserved arrow space, a readable minimum table width inside its existing horizontal scroll region | `skins.css` |
| Grouped comparisons used hard-coded red/green text | Shared positive/negative text tokens in both themes | `season.css` |
| Ranked charts had very short bars beside team labels at intermediate widths | Chart cards leave subgrid mode and stack below 1200 px | `ui-controls.css` |
| Hiding explanations also hid load errors | Error messages remain visible independently of explanatory copy | `skins.css` |
| Selected qualifying segment retained a blurred drop shadow | Keep the selected fill and inset hairline, remove the decorative shadow | `skins.css` |
| Catalogue heading outside its grid had browser-default sizing | Apply the shared section-heading recipe throughout the catalogue | `skins.css` |
| The standalone catalogue was obscured by the workspace frame mask | Exclude the catalogue without increasing selector specificity on application pages | `skins.css` |
| The selected tyre-compound option failed automated contrast checks | Use the shared neutral selected fill and primary text | `skins.css` |
| Fallback team monogram used 8 px type | Raise its base size to the supported 10 px floor | `skins.css` |
| Expanded tyre evidence used an off-scale search field | Match the shared 28 px field geometry and 12 px label type | `skins.css` |
| Season's main content waited for photo metadata and circuit shapes | Render the data first; hydrate existing avatar/outline nodes and licence credits without replacing tables or losing focus | `season.js` |
| Power-unit and upgrade data requests started after the main season response | Request independent datasets concurrently, preserving existing snapshot/live-source selection | `season.js` |
| Audit swallowed route failures and only captured initial scroll positions | Record errors in JSON, fail unsuccessful runs, wait for stylesheets/fonts, capture lower sections and horizontal table edges | `scripts/audit-linear.mjs` |

No additional cascade layer or dependency was added. The five obsolete sortable-heading rules were removed from `season.css`; sorting appearance belongs to `skins.css`. The numerical calculations, API contracts, recorded data, telemetry samples, and team identity colours are unchanged.

## Verification records

Machine-generated output and screenshot evidence live under the ignored `test-results/` directory. The broad audit is `linear-refined.json`; final recaptures of changed or invalidated states are `linear-final.json`. Captures taken while a concurrent test setup rebuilt static assets are invalid evidence and must be replaced by the stable-output recaptures. Do not interpret a passing token audit as proof of visual fidelity.

The new browser regressions cover default sorting, keyboard reversal, actual numeric row order, focus restoration, grouping, and chart-grid column counts at desktop/tablet/phone widths. Existing shell tests cover the error-state visibility fix.

Verified: 427 unit tests; type checking and lint; source-recording integrity (744 files, including 19 season snapshots); a broad 144-render audit; 42 stable recaptures for changed/invalid states; six final catalogue renders with no property findings; and the corrected 1024 px Pace capture with no property findings. A clean Chromium run passed all 90 interaction, accessibility and visual tests. Both sorting regressions subsequently passed against the final historical-column fallback. The production R2 build succeeds, retains `_headers`, and contains zero static data files. No data was uploaded.

The six existing Pace/Cornering/Tyre visual baselines pass without refresh. Catalogue baselines were refreshed for the reviewed clipping, heading and monogram fixes. Browser assertions also check actual card positions, because a declared single-column grid alone did not prevent subgrid from creating implicit columns. `--expand-details` additionally opens native disclosure panels for auditing and scroll capture.

## Season loading investigation

Two delayed-network browser tests reproduced the old loading blockers: holding photo credits prevented Standings from rendering, and holding the main season snapshot prevented the power-unit snapshot request from starting. After the loading changes, data can render while imagery remains pending and the secondary data request starts independently. A third regression covers delayed circuit outlines on Schedule. Photos and their licence credits hydrate together; the tests also verify keyboard focus survives hydration. This proves removal of those dependencies, not a universal wall-clock speedup under every network condition. The explicitly enabled local-compute connection check remains unchanged and can still take up to 1.5 seconds when the local service is unavailable.

Season checkpoint verification: all five loading/sorting regressions passed, all 427 unit tests passed, lint and type checking passed, and 36 expanded/scrolled Season renders (seven tabs plus power-unit grouping variants, both themes, 1440/390 px) completed with zero property findings. The preceding full Chromium suite passed 90 tests before the isolated Season-loading changes. Subsequent cross-browser checks are recorded below.

Scroll QA was corrected after duplicate phone captures were detected: the audit now prioritizes document scrolling and brings a nested scrolling container into view before capturing it. The corrected capture hashes differ across scroll positions; earlier duplicate images are not valid evidence of lower-page coverage.

## Completion inventory

| Area | Review and resulting behavior |
| --- | --- |
| Shell, rail, header, breadcrumbs and toolbar | Measured app specification retained; desktop/tablet/phone alignment and overflow checked. Standalone catalogue no longer inherits the frame mask. |
| Cards, metrics, badges and notes | Shared surface/type hierarchy retained; chart/section headings, numbered marks and semantic comparison colours corrected. No calculation or confidence labels removed. |
| Buttons, segmented choices and selectors | Catalogue control families reviewed with hover, pressed, disabled, keyboard and focus states. Season choices and rebuilt selectors retain focus. Telemetry loading action indicates pending work. |
| Menus, popovers, dialogs and command search | Keyboard navigation, Escape, modal focus containment/return, short-viewport positioning and reduced-motion checks exercised. |
| Tables and disclosures | Sorting indicates the current order, uses native buttons and survives missing historical columns; header space, numerical alignment, scrolling, expansion and focus checked. |
| Ranked/diverging bars and uncertainty ranges | Shared scales and exact numerical output retained; full values, uncertainty and provisional context available by keyboard. |
| Trend, lap, championship and position charts | No added smoothing or gap interpolation. Point/round information available by focus and arrows; stable identities preserve the selected point during background renders. |
| Scatter, finishing-position histogram and tyre-stint plots | Keyboard access added to values previously limited to native hover. Histogram and SVG round hits share the value-card behavior. |
| Telemetry channels, map and corner inspector | Existing synchronized coordinates, channel controls, zoom, alignment labels, selected-distance table and map semantics retained; loaded comparison and layout checks exercised. |
| Tooltips and linked chart states | Bounded, dismissible value cards; a line above a transparent hit region no longer interrupts hover. Read-only updates no longer rescan the entire page for controls. |
| Loading, empty and failed requests | Season data renders before imagery; independent requests start together. Pending/error announcements, absent measurements, visible errors and retry actions checked. |
| Responsive and motion | 1440/1024/390 route matrices, 320 px catalogue containment, expanded/scrolled content and reduced-motion behavior checked. Firefox uses context-created viewports because its runtime resize command hangs. |

The six requested phases have implementation and verification records above: reference discovery, system consolidation,
route refinement, visualization review, interaction/responsiveness, and final checks. Retained foundational CSS is not
deleted merely for age: the existing ownership tests protect the active primitives, and this pass removes the obsolete
sortable-heading declarations it replaces. No additional styling layer or visualization library was introduced.

## Reference and platform bounds

The inventory covers reusable UI families, routes and representative data states rather than every possible race/driver/filter permutation. Native disclosure panels were opened in additional sweeps; invalid captures caused by missing static QA data or duplicate scroll positions were replaced. The audit rejects Season load-error screens instead of counting them as populated views.

No authenticated Linear browser is currently connected, so the saved signed-in measurements remain the primary reference. Light-theme reference values remain published approximations. F1-specific visualizations are explicitly inferred adaptations, not claims that Linear provides equivalent charts.

The original Firefox runtime failed to launch; an isolated official runtime works. Its dynamic viewport-resize command also hangs on a blank page with no application code. This resembles the [documented Windows resize issue](https://github.com/microsoft/playwright/issues/43028), but the local blank-page reproduction is the evidence for this environment. Fixed-size desktop/tablet/phone contexts cover Firefox; Chromium and WebKit cover live resizing. Browser-specific emulation capabilities are skipped only where unavailable.

Publication is code-only: numerical calculations, API contracts and data revisions are unchanged. R2 data and prepared data are not uploaded by this release; source-only recording validation is reported separately from production data compatibility.

## Release verification and publishing status

The final broad Chromium/WebKit run completed 230 cases: 207 passed, five capability-specific cases skipped, two failures exposed an Escape-dismissed chart tooltip reopening during a background redraw, and 16 WebKit performance screenshots disagreed with older baselines. The tooltip now retains dismissal for the same chart value across redraws; a regression explicitly exercises that redraw. Focused rerun results are recorded with the release below.

WebKit baseline drift was checked against the unchanged version-212 Site source (`dfe3fd43fb3549d951ffe825f33e7a0d3570eb2b`). The Pace actual screenshot is byte-identical in old and refined source (SHA-256 `BE8902E9724B7A86B5424264ED886AFCEDA7E38ECAEBBA850EF61D6FB437C0AD`). Full-height WebKit element screenshots also show the fixed workspace mask below the initial viewport; expanded/scrolled viewport captures provide the lower-page visual evidence rather than treating that masked area as verified content.

The Sites credential endpoint rejected publication with `sites_git_client_upgrade_required` (409): Git access is not enabled for this client and requires a hosted Work session or a later Codex/Sites rollout. No source credential was issued, no Site source was changed, and no deployment was attempted. The public Site remains at version 212 until the supported publishing path is available. This is a connector capability block, not a source-build failure or a request for another user confirmation.

Final source checks pass: 427 unit tests (four skipped), TypeScript, lint, source-tree integrity, and 744 structurally valid source recordings including 19 season snapshots. All 32 Python test files pass across the main run and a focused retry: `test-server-performance.py` passed its 14 assertions but initially hit a Windows temporary-file cleanup race; its unchanged focused rerun passed cleanly. The isolated production build succeeds, retains `_headers`, and includes zero static data files.

The post-fix Chromium/WebKit route-and-chart run passed 27 of 28 cases: all twelve complete route matrices (15 routes each, both themes at 1440/1024/390 px) and every chart case except a WebKit tyre timeout under concurrent load. The same tyre keyboard/redraw/Escape case passes against the isolated final build in 32.7 seconds with one worker. The preceding Firefox run passed fourteen fixed-viewport, loading, sorting and control cases. No dynamic Firefox resizing is claimed.

All sixteen stale WebKit performance baselines were byte-identical to the unchanged version-212 source and have been refreshed to that verified rendering. The selected-compound contrast change is covered by accessibility checks rather than claimed as a difference in the default tyre screenshots. Catalogue and application-shell baseline changes were reviewed separately, with the pre-existing phone rendering also reproduced byte-for-byte against version 212. Four final performance keyboard cases and all sixteen performance snapshots pass against the isolated production build across the main run and the two-case tyre confirmation run (both passed in 38.7 seconds).

The final Firefox chart suite passes all eight cases, including Season values in both themes at desktop/phone widths, ranked/diverging bars, trends and scatter. The expanded inventory and reference limitations above apply to these results; this is representative route/state coverage, not every possible data permutation.
