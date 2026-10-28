# Front-end architecture (October 2026)

The site is one page (`index.html`) served under `/apex/`, with two views:
session analysis and car performance. The Python backend and the data cache
are unchanged by this restructure.

## URLs

`url-state.js` keeps each view's state in the address, with the History API:

| View | Example |
| --- | --- |
| Session analysis | `/apex/?year=2026&round=17&session=Qualifying&laps=VER.11,NOR.16` |
| Car performance | `/apex/cars/corners?year=2026&scope=tracks&races=15,16,17&subject=driver&run=1` |

The category is the path (`/apex/cars`, `/apex/cars/braking`, …); filters are
query parameters and defaults are left out. Changing category, GP or laps adds
a history entry; changing a filter replaces it. Older `?view=cars&metric=`
links are rewritten to the path.

Both servers serve `index.html` for any extension-less `/apex/` path
(`worker/index.ts` for the hosted site, `lib/local-server.mjs` locally), and
`<base href="/apex/">` keeps relative asset links working from deeper paths.

## Scripts

| File | Owns |
| --- | --- |
| `url-state.js`, `motion.js` | Shareable URLs; navigation motion |
| `session-*.js` (9 files) | Session analysis, in load order: state and data, loader, laps, charts, hover, corners, map, start-up, tyres. Classic scripts sharing one global scope (formerly `app.js`). Tests read them joined via `scripts/app-source.mjs`. |
| `car-performance.js` | Car-performance state, data loading, view data for the React views, and the page chrome (metric tabs, telemetry controls, evidence panels) (ES module) |
| `performance-format.js`, `performance-identity.js` | State-free helpers: formatting and statistics; team marks, flags, Pirelli allocations |
| `src/` | React components and views, bundled by `scripts/sync-static.mjs` (esbuild) into `react-islands.js` |

## React views

`car-performance.js` computes a view's data and returns a placeholder
(`reactView(name, props)`); `render()` mounts the React views synchronously,
before the layout pass. Components render the existing classes and `data-*`
attributes, so the stylesheet, the component ownership layer (`ui-system.js`)
and the delegated click handlers keep working unchanged.

Shared components (`src/components/`): `Card`, `SegmentedControl`,
`BarChart`, `DataTable` with `SortHeader`, `TeamLabel`/`TeamLogo`/`EventLabel`,
`RetirementBadge`/`CountBadge`, `Sparkline`, `ValueNote`, `DivergingBarChart`,
`TyreStintPlot`. Views (`src/views/`), one per category: `PaceView`,
`SpeedView` (qualifying Cornering, Straight line, Braking), `RaceCornersView`
(race Cornering), `PitsView`, `TyresView`, `TrendView` (Development &
updates), `ResultsView` (Reliability & results).

Moving another category: build its plain view data in `car-performance.js`,
return `reactView('<name>', data)`, add `src/views/<Name>View.tsx`, register it
in `src/islands.tsx`, and render-test it in `scripts/test-react-views.mjs`.
Still string-rendered: the car-performance chrome around the views and the
whole session-analysis view. The retired window-timing views (`renderTrace()`,
race speed traps, matched qualifying corners, season lap-gap and circuit audit
cards, team braking loader) were removed; qualifying Cornering, Straight line
and Braking always use the speed-domain method.

## Pre-rendered data

A season is built on this PC in three steps, each resumable:

1. `.venv/Scripts/python.exe scripts/mirror-openf1.py --year 2026` downloads
   every driver's whole-session car data, position and laps for each finished
   qualifying, sprint qualifying, sprint and race, paced under OpenF1's limits
   (free plan: 3 requests a second, 30 a minute). Raw data does not depend on
   the methodology, so it is downloaded once; the backend then slices any lap
   from disk (`openf1_session_stream`). A season is about 3,000 streams and
   500 MB, roughly 1.5 hours.

   The archive is the one irreplaceable part, so it lives in `~/apex-data/openf1`
   (`APEX_RAW_ROOT` overrides), outside every checkout and worktree: moving or
   deleting a repo folder no longer takes it along. Files from the old
   in-repo `.apex-cache/openf1` are still read in place. Keep it current with
   `scripts/mirror-openf1.py --year 2026 --watch 30`: each pass lists the
   sessions, skips those recorded in `mirror-state.json` and downloads only
   what finished and settled (six hours, for timing corrections) since.
2. `npm run local:warm` (with `npm run local` running) computes every
   finished GP with the current methodology: car-performance summaries,
   telemetry batches, corners, pit stops, sprint, and the session-analysis
   summaries. With the mirror this needs no network.
3. `npm run prerender` exports settled entries to
   `assets/data/prerendered/<hash>.json.gz` with an `index.json` manifest.

The page reads a pre-rendered file before calling the API (`preparedData` in
`session-state.js`), but only when the entry's revision matches the page's:
the backend revision for car performance, the source revision for session
summaries. A methodology change never serves stale numbers; rerun steps 2-3
(minutes, from the mirror). Per-lap telemetry stays on demand.

## Motion

`motion.js` wraps navigation (category and view switches on a pointer click)
in a view transition; bars grow once when a category opens. Data refreshes
never animate, keyboard activation switches instantly so focus can move, and
`prefers-reduced-motion` turns it all off. Styles are at the end of
`macos-window.css`.
