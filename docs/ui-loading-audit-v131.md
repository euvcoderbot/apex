# UI and loading audit — v131

Date: 17 October 2026. Scope: session comparison and all eight car-performance categories. Representative live data: Singapore 2026; retained source data and local disk caches were preserved.

## Outcome

The comparison workflow now prioritises seeing traces and the circuit together. Selection is a separate, collapsible setup area; results use compact, aligned rows. Repeated counts and supporting diagnostics no longer compete with the main analysis.

This is a macOS-inspired web implementation, not AppKit or SwiftUI. It cannot honestly be certified as matching every native Apple element, font, material or animation exactly on Windows. The changes follow the grouping, alignment, adaptability and progressive-disclosure principles in Apple's [Layout guidance](https://developer.apple.com/design/human-interface-guidelines/layout). Related options use consistent selection states, following [Segmented controls](https://developer.apple.com/design/human-interface-guidelines/segmented-controls); sortable and resizable columns remain available, consistent with [Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables).

## Requested fixes

| Area / screenshot | Change |
| --- | --- |
| Traces and corner map | Removed the mutually exclusive view tabs. Desktop places traces left and the map/corner inspector right; the inspector stays beside the trace stack while scrolling. Narrow layouts stack both regions without requiring a tab switch. Explicit chart-focus mode remains optional. |
| Driver list | Replaced the short internally scrolling list with a full-width responsive grid above the lap cards. Full driver names wrap instead of being clipped. The whole setup area can still collapse after comparison. |
| Event tyres, image 1 | Replaced three tall boxed tiles with a compact labelled strip, with inline tyre icons and compound names. |
| Summary sectors, image 2 | The combined S1–S3 column is capped at 48% and 540 px on desktop. Measured at about 45% of each summary card at the normal preview width. Narrow layouts deliberately use a separate full-width sector row for legibility. |
| Speed-annotation inventory, image 3 | Removed the extra inventory disclosure/table and its renderer. Optional labels on the trace itself remain. |
| Lap choices, image 4 | Removed the plus/check selection box. Selected laps highlight and expose `aria-pressed`. Lap token/state labels, time and tyre badge have explicit grid positions; run/age information spans the second row. IN/OUT and SC/VSC labels remain in normal flow. |
| Pace chart pair, images 5–6 | Shared heading, control, data and footer rows align the two cards and the first ranked rows. Shortened qualifying controls to Fastest lap / Adjusted, retaining the methodology tooltip. |
| Mean / Median GP gap | Moved this control into the estimated race pace chart. It now affects race pace only, not qualifying. Hide it with fewer than three loaded race GPs, where standard mean and median necessarily coincide. |
| Floating coverage notes, image 7 | Non-actionable coverage/assumption paragraphs are grouped in closed disclosures. Active loading messages, retry actions, missing-data rows and failures are not hidden. |
| Straight charts, image 8 | Grouped the three rankings in a closed Straight-line rankings and acceleration disclosure. When opened, their controls and first rows align. Units and speed-range selection remain attached to their respective charts. |
| Large measurements, image 9 | Primary straight/braking tables now live in closed Measurements and timing support disclosures. Their table DOM is deferred until opened. Existing exact source/coverage evidence remains available below. |
| Pit chart and table, image 10 | Matching surfaces, padding, header space and 34 px data rows. Shortened headers to Mean, Median, Quickest, Spread (IQR), Visits and Races. Individual visits are closed by default. |
| Entry counts | Removed the repeated N entries heading and the all-complete ranked footer. An unranked count still appears when it communicates genuinely missing measurements. Accessible table captions remain. |
| Compound selection | Restored compact compound pills, including the overall option. Selected state and focus survive a compound change. |
| General controls | Shared compact segment sizing; chart controls no longer inherit large margins. Pop-up menus close without a lingering fade. Touch-specific larger targets, focus rings, reduced-motion and contrast alternatives remain. |

## Mean / Median: what was actually wrong

The former toggle was not universally broken: averaging one GP produces the same result as taking its median. Standard median of two values is also their mean. Displaying that control for the single-Singapore case misleadingly promised a visible change.

There was also a scope problem: the old shared statistic changed qualifying and race summaries together, despite its placement above both charts. Qualifying now consistently uses the mean of its event-relative deficits. Race pace alone can switch mean/median when three or more race GPs are loaded. The default mean results are unchanged. Choosing Median in a multi-GP view is therefore deliberately different from the old shared qualifying/race behaviour.

Regression data with three skewed race observations verifies a mean of 10 versus a median of 4, while qualifying stays at its mean of 8. This is a test fixture, not a claim about an actual team.

## Browser verification

| Check | Observed result |
| --- | --- |
| Eight categories × 1280 / 1024 / 768 / 390 px | No page-wide horizontal overflow or clipped visible button labels in the cached Singapore replay; no stuck loader observed. Wide measurement tables retain their own horizontal scrolling. |
| Session traces + corners | Both regions visible together. Desktop sector share 45.14%. Both remain present at narrow width. |
| Driver grid | At 1280 px, five columns, height and scrollHeight both 206 px. At 390 px, two columns, height and scrollHeight both 614 px. No clipped driver names. No nested driver-list scrolling. |
| Real qualifying lap choices | 13 displayed choices, zero child overflow at narrow width. |
| Combined status fixtures | IN+SC, OUT+VSC and IN/OUT+SC: zero child overflow at 390 px. Fixtures are labelled examples in the component catalogue, not inserted into race data. |
| Pace pair | Identical card heights and first-row positions. Final measured height 469.56 px for both cards. |
| Straight chart group, expanded | All three cards 490.43 px high with identical first-row positions; common control row about 35.64 px. |
| Pit chart/table | First data-row positions identical; row height about 34 px. |
| Compound C4 | Selected state true and keyboard focus retained after rerender. |
| Deferred primary evidence | Closed: zero table elements. Opened: loaded=true and 11 team rows. |
| Browser console | No captured error entries during the final cached workflow check. |

The existing trace pointer handler still updates the shared hover fraction and calls the map hover renderer. Regression tests cover the shared rendering path. The browser-control surface did not expose a pointer-hover operation, so a live pointer-hover gesture was not independently exercised in this audit. Keyboard, selection and layout checks are not a substitute for that gesture.

Visual proof: `outputs/apex-v131-telemetry.png` and `outputs/apex-v131-pit-stops.png` in the parent build folder.

## Loading audit and local compute

The running local dashboard uses loopback Python for parsing/calculation and disk caches under `.apex-cache`; local mode does not use Vercel. No cache was cleared for this release. A published website does not automatically gain access to a visitor's PC: use the local dashboard for local processing.

Two repeated read-only requests were timed per endpoint. These used retained data and are **not cold first-download/full-season benchmarks**.

### Direct parser — port 8000

| Request | First / second request | Result |
| --- | --- | --- |
| 2026 calendar | 3159 / 3032 ms | HTTP 200; 15,867 bytes |
| Singapore qualifying performance | 288 / 19 ms | HTTP 200; 52,163 bytes |
| Singapore race performance | 2991 / 2944 ms | HTTP 200; 333,517 bytes |

### Dashboard cache/proxy — port 54123

| Request | First / second request | Result |
| --- | --- | --- |
| Calendar | 195 / 13 ms | HTTP 200, cache HIT |
| Singapore qualifying performance | 14 / 3 ms | HTTP 200, cache HIT |
| Singapore race performance | 10 / 10 ms | HTTP 200, cache HIT |

The meaningful improvement is reuse through the dashboard cache, not a claim that all parsing is instantaneous. Direct parser race/calendar requests can still take around three seconds; initial upstream downloads and fresh native-telemetry batches can take longer. Current-calendar freshness policy and source-cache expiry rules were not weakened.

Presentation changes reduce unnecessary work: closed supporting tables are deferred, and table decoration no longer measures closed tables and creates incorrectly narrow resize columns. Existing request coalescing, cancellation, source concurrency limits, cache expiry and failure handling remain covered by the suite.

## Code cleanup

Removed obsolete session-view state/setter/listeners, the speed-annotation inventory renderer and its template host, the empty trace-colour binding path, lap plus/check markup, the obsolete compound-dropdown handler, the redundant acceleration hint, and table-entry heading construction.

The stylesheet builder strips **39 confirmed retired selector entries** from the shipped bundle. It prunes selector lists individually so unrelated live selectors survive. This is targeted cleanup, not an unsafe attempt to infer that source/model code is unused from one browser session.

The scientific models, raw lap inventory, source caches, qualifying/race eligibility, timing-gap rules and unranked rows are retained. Only the documented scope of the optional pace summary statistic changed. Source/backend/race calculation revisions remain unchanged; presentation assets receive their own fingerprint.

## Category consistency review

| Category | Review outcome |
| --- | --- |
| Pace | Matched chart grid; scoped race statistic; compact qualifying choice; coverage remains expandable. |
| Cornering | Shared compact controls and accessible heading; coverage notes grouped; missing turns stay unmeasured. |
| Straight line | Chart group and detailed measurements closed by default; expanded chart rows aligned; missing acceleration crossings not filled. |
| Braking | Supporting table collapsed/deferred; approach and slowing evidence retained; active loading/retry actions remain visible. |
| Pit stops | Matching chart/table rhythm; exact visits collapsed; minimum sample requirements unchanged. |
| Tyre trend | Compound pills restored; fuel assumption stays attached to fuel-correction controls; run evidence remains expandable. |
| Development & updates | Responsive control/text check passed; no fabricated upgrade-attribution data added. |
| Reliability & results | Responsive control/text check passed; source classifications and missing-data distinctions retained. |

## Verification limits and remaining debt

- Tests cover arithmetic, caches, loaders, telemetry and UI contracts; browser checks used one cached GP, not every season/event or every upstream failure mode.
- No fresh full-season upstream download benchmark, real-device touch test, VoiceOver/NVDA walkthrough, or live pointer-hover gesture was completed in this pass.
- Emoji rendering and native form/scrollbar details depend on the operating system. This is not an exact native macOS renderer.
- Several legacy stylesheet layers remain. Their active rules should be consolidated component-by-component with visual regressions, not deleted wholesale. The bundle is still substantial; this release is not a complete CSS-size optimisation.
- Supporting diagnostics are intentionally preserved in disclosures. Sparse or disconnected observations are still unranked; presentation cleanup does not turn missing telemetry into complete evidence.

Automated verification: `node --test scripts/test-*.mjs` — 215 passing tests. `npm run build` completed successfully. Vinext emitted its existing route-classification advisory; it did not fail the build.
