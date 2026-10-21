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
| `car-performance.js` | Car-performance state, data loading and the categories not yet moved to React (ES module) |
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
`RetirementBadge`. Views (`src/views/`): `ResultsView` (Reliability & results).

Moving another category: build its plain view data in `car-performance.js`,
return `reactView('<name>', data)`, add `src/views/<Name>View.tsx`, register it
in `src/islands.tsx`, and render-test it in `scripts/test-react-views.mjs`.
Still string-rendered: Pace, Cornering, Straight line, Braking, Pit stops,
Tyre trend, Development, and the whole session-analysis view.

## Pre-rendered data

`npm run local:warm` computes a season with the current methodology;
`npm run prerender` exports settled entries to
`assets/data/prerendered/<hash>.json.gz` with an `index.json` manifest. The page
reads a pre-rendered file before calling the API (`preparedData` in
`session-state.js`), but only when the manifest's revision equals the page's
methodology revision, so a methodology change never serves stale numbers.

## Motion

`motion.js` wraps navigation (category and view switches on a pointer click)
in a view transition; bars grow once when a category opens. Data refreshes
never animate, keyboard activation switches instantly so focus can move, and
`prefers-reduced-motion` turns it all off. Styles are at the end of
`macos-window.css`.
