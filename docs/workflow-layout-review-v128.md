# Layout rethink — setup, comparison, evidence

## Design rule

Each view has one sequence: choose the source, choose what to compare, read the result, inspect its evidence. Setup controls should not permanently consume the canvas. A control belongs beside the particular result it changes; a diagnostic should not dominate the default view. This is a web adaptation of Apple's [split-view](https://developer.apple.com/design/human-interface-guidelines/split-views) and [tab-view](https://developer.apple.com/design/human-interface-guidelines/tab-views) guidance, not native AppKit rendering.

## Shared placement

| Area | Previous problem | New placement and reason |
| --- | --- | --- |
| Site navigation | Could be confused with measurement choices | The header still contains only the two top-level areas. |
| Display preferences | Previously scattered actions | One title-row group; it follows the active area and does not affect the layout of results. |
| Source selection | Separate full-width race chooser below the main car controls | Season, scope, selected races and Analyse share one setup card. The race grid opens below that same row. |
| Status | A competing card or large explanation | A quiet line between setup and results. Loading, failures and unsupported measurements remain visible. |
| Category navigation | A permanent left rail removed width from every car chart and table | One horizontal, wrapping category bar. All categories remain visible. Narrow screens use a two-column choice grid, not tiny text or horizontal scrolling. |
| Measurement context | Season and subject repeated in several blocks | The source controls provide season; subject choices sit beside the category title; a compact loaded-event count remains visible. |
| Optional methodology | Long text competing with numbers | Existing explanation and evidence disclosures are preserved. Important estimates, unsupported measurements and errors are not hidden. |

## Session analysis

| Feature | Change and placement rationale |
| --- | --- |
| Drivers and race points/gaps | Moved into the lap-selection inspector. They help choose laps; they are not a permanent navigation rail beside the charts. |
| Event tyres | Kept beside the driver/run chooser, because the allocation helps select a run. It no longer reduces the width of telemetry. |
| Runs, phases and lap tiles | Stay beside the driver list while choosing laps. Existing phase, tyre-age, pit-lap and selection information is retained. |
| Compare fastest | Remains in the inspector heading. Once it loads laps, the inspector collapses; Edit laps restores the same choices. No selection or telemetry cache is cleared. |
| Manual lap inspection | Can stay expanded while individual laps are selected. Collapse is a separate explicit action; only Compare fastest advances to the compact analysis state automatically. |
| Comparison/reference controls | Moved from the end of the picker to the beginning of telemetry, where the selected laps and reference actually matter. |
| Sector times and weather | One full-width compact row per loaded lap. Removed the second visible Comparison laps heading while retaining the accessible region label. |
| Traces | A dedicated analysis pane, visible by default. Speed and timing delta appear without scrolling past the circuit map. Other channels remain available below them. |
| Corner performance and map | A separate Corners & map pane using the same loaded laps. Selections and map mode survive tab changes. Hidden map/corner rendering is skipped until requested. |
| Zoom, trace visibility and colour | Remain with the trace chart. Existing expand/close chart mode is preserved. |
| Keyboard and focus | Tabs support Left/Right/Home/End. Collapsing the picker removes its hidden controls from keyboard interaction. Compare fastest focuses the Edit laps control without scrolling. |

## Car performance — every category

| Category | Result-first layout |
| --- | --- |
| Pace | Qualifying and race charts stay side by side when space permits. Qualifying-only evolution controls move inside the qualifying chart, so they no longer imply they alter the race estimate. The shared GP statistic stays outside both charts. |
| Cornering | Subject and session choices sit beside the heading. The primary comparison and measurement table retain their relationship; turning windows, missing-turn evidence and race support stay available in existing disclosures. The full page width is available instead of width minus a permanent rail. |
| Straight line | Three adjacent summaries remain: supported straight speed, top speed and acceleration. Straight-gap units and coverage move inside the straight-speed chart. The acceleration range remains attached to its own chart. Removed the redundant second category heading. |
| Braking | Keeps the two existing calculations and supported-sample policy. Chart and table use the reclaimed width. Subject controls sit beside the heading; removed the duplicate Braking performance heading. No extra comparison modes were added. |
| Pit stops | Service/lane/visit/statistic choices remain with the pit summary and its table. Removed the redundant second pit heading. Missing timing and retry controls remain visible; visits remain inspectable. |
| Tyre trend | The compound/measurement controls and aggregate chart/table remain primary. The individual driver/run selectors and run plot are grouped under Inspect a tyre run. Opening or changing the run retains the disclosure through redraws. |
| Development & updates | Progression needs horizontal room for round history and changes, so the table now uses the full content width. A one-race selection still honestly reports that a progression cannot be established. FIA document evidence stays below the comparison. |
| Reliability & results | The chosen results chart and concise table remain primary. Race/sprint point columns and detailed retirement evidence are preserved; the wider layout gives these columns more room. |

## What did not change

No ranking algorithm, eligible-lap rule, source selection or numerical score was changed for this layout release. No unavailable measurement was replaced by zero or an invented value. Local processing and durable caches remain in place. UI-only source edits preserve the source/backend/race-measurement revision families.

This is a placement and interaction review, not a claim that every historical dataset or every combination of measurement filters has been independently revalidated. Representative Singapore 2026 data and the complete JavaScript regression suite are used for verification.
