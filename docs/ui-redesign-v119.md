# Workspace UI redesign — v119

Presentation release for Session analysis and Car performance. No observations,
eligibility thresholds, metric formulas or ranking methods were changed.

## Shared interface

- Unified slate/blue dark palette and complementary high-contrast light palette.
- Flat surfaces, quieter borders, consistent card radii, smaller shadows and less glass.
- Consistent spacing, compact controls, tabular numerical text and clearer heading hierarchy.
- Smaller brand/header footprint with separate primary navigation and utility actions.
- Introductory context for each analysis workspace.
- Keyboard skip link targets the currently selected workspace; both targets are focusable.
- Responsive single-column layouts, locally scrolling tables/navigation, and reduced-motion support.
- All UI assets participate in a browser-only content hash. CSS/presentation changes do not
  independently invalidate raw timing and telemetry caches.

## Session analysis: category-by-category changes

| Feature | Implemented improvement |
| --- | --- |
| Session selection | Compact selector bar; mobile Season and Session have separate grid cells, GP uses a full row, Load session uses a full-width action row. |
| Driver selection / results | Narrower sticky desktop sidebar, denser identity rows, team-coloured selection edge; two-column, height-limited mobile driver list. Existing points/gap controls preserved. |
| Event tyres | Three-column allocation strip instead of three full-width rows. |
| Lap workspace | Responsive side-by-side driver cards; cards align to their own content height; concise action hint. |
| Stints / qualifying runs | Compact run controls; bounded scrolling lap grid; minimum tile width and explicit number/time/compound columns prevent IN/OUT label collisions. |
| Comparison tray / reference | Compact wrapping lap pills; team-coloured reference treatment; visible instruction explaining how to change the reference. |
| Sector comparison / weather | Tighter lap-summary cards, sector cells and condition rows; responsive card grid preserves lap, tyre and sector information. |
| Corner / straight selection | Wrapping, height-safe section picker; compact selected-state treatment; smaller detail cards. Selection semantics remain unchanged. |
| Corner metrics / mini-sector map | Consistent surface and border, compact map controls, capped map height, balanced chart/detail layout on wide screens. Combined-zone boundaries remain the original measured ones. |
| Circuit guide | Same compact map treatment; guide/comparison switch and factual source content retained. |
| Speed trace | Tighter toolbar, display settings and trace-visibility pills; clearer units and consistent control styling. Native distance alignment unchanged. |
| Timing delta | Same compact channel/header treatment and zoom controls; full-width distance axis retained to align with the speed trace. |
| Throttle / brake / gear / historic RPM | 132 px normal-view channels rather than inherited 165/135 px heights; preserved full-width aligned distance axes. Historic DRS retains its binary-channel height. |
| Hover / trace colours / zoom | Smaller tooltip and trace chips; consistent interaction/focus styling. Existing source labels, colour pickers and synchronized hover/zoom preserved. |
| Expanded charts | New compact input-height rules are explicitly excluded from focused mode. Existing full-screen speed/delta layout retained. |
| Hidden-channel rendering | Skip zero-sized hidden canvases before allocating/copying drawing buffers, fixing a browser canvas error on view/focus transitions. |
| Empty states | Quieter bordered telemetry placeholder and clearer workspace guidance. |

## Car performance: category-by-category changes

All eight categories receive an indexed title, a concise purpose statement,
season and loaded-GP context, compact controls, normalized tables and readable
source/quality notices. Context counts refer to loaded events, not necessarily
supported events for every metric; original per-metric coverage remains visible.

| Category | Implemented improvement |
| --- | --- |
| Selection / progress | Compact season/scope bar; aligned event grid; keyboard-operable event-tray disclosure; tray collapses after Analyse and reopens when Tracks is selected. Selection count and selection actions remain available. Compact status bar and sticky desktop metric navigation. |
| Pace | Qualifying and race charts paired side by side in one workspace, rather than vertically duplicated full-width cards. Shared detail table below. Chart subtitles remain visible with explanations disabled. |
| Qualifying cornering | Compact chart-and-table split on desktop; existing All/Low/Medium/High filters and team/driver modes preserved. |
| Race cornering | Same chart-and-table layout, with matched-lap counts, sparse evidence and in-progress notices retained. |
| Straight line / top speed / acceleration | Three coordinated charts in a responsive grid: three columns on wide desktops, two at intermediate widths and one on mobile. Acceleration range controls stay attached to their chart. Detailed multi-column evidence stays below. |
| Race speed traps | Compact chart-and-table workspace with original official speed/source fields. |
| Braking | Same-speed slowing and Time through remain the only two approaches. Chart and paired-measurement table placed together; timing-evidence/sample columns preserved. |
| Pit stops / pit lane | Compact ranking beside timing table; all existing mean/median/quickest/IQR, team/driver and lane-basis controls retained. Exact individual-visit evidence styled consistently. |
| Tyre trend | Signed trend chart beside coverage table; smaller four-column stint filters (two on mobile); bounded stint-plot height; consistent individual-run evidence. C-grade, observed/fuel-adjusted and matched-rivals controls retained. |
| Development / updates | Denser progress table, smaller sparklines, clearer headings and uniform coverage badges; original opening/latest and fitted trends retained. |
| Reliability / results | Outcome chart beside detailed results table; normalized retirement badges and cause-table spacing. Existing results measures retained. |
| All bar charts | Shorter tracks and denser rows, consistent labels/values, visible subtitles, explicit ranked-entry counts and missing-entry totals. Unranked entries are not converted to zero or hidden. |
| All tables / sorting | Consistent numeric typography, compact cell padding, restrained alternate rows, hover feedback, entry counts, visible sort/scroll guidance and accessible captions. Existing sort-state/scroll restoration preserved. |
| Sources / exact evidence | Consistent disclosure styling, compact searchable evidence filters; lazily hydrated tables receive the same captions and table framing as primary tables. |

## Verification

- 180 JavaScript regression tests pass, including five new presentation tests.
- CSS parsed with PostCSS; JavaScript syntax checks and production build performed.
- Browser pass over all eight car categories using 2026 Bahrain + Singapore data.
- Exercised pit team/driver, stationary/lane and mean controls; corner speed-band,
  team/driver and race/qualifying controls; both braking views.
- Browser checked two-lap Singapore qualifying comparison, combined T1 + T2
  selection, map/trace rendering, expanded chart open/close, dark/light themes,
  390 px responsive layouts and local horizontal scrolling without page overflow.
- Slow background telemetry retrieval and provisional/sparse rankings still reflect
  source availability; this UI release does not claim to repair or revalidate them.

Proof images are saved alongside the release outputs.
