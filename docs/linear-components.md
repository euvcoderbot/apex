# Linear components: recipes for new UI

Read this before adding or changing any visible element. The site has one look, Linear's (`<html data-skin="linear">`).
**The specification is [linear-design-spec.md](linear-design-spec.md)**: values measured in the signed-in Linear app [A], which
win over anything below or in the older documents. Background: [linear-design.md](linear-design.md). The
foundations (colours, type ramp, radii, motion and their sources) are in [linear-look.md](linear-look.md); the frame and layout
(rail, location header, content, inspector) are in [linear-workspace-spec.md](linear-workspace-spec.md); tokens and their owners are
in [design-tokens.md](design-tokens.md). This file says how to build each kind of element from those, so new work matches what is
already there. When a new element does not fit a recipe below, find the nearest existing element on the site and copy its rules;
then add the recipe here.

## Before you write CSS

- **Reuse first.** Use the existing class when one exists: `.performance-chart-card` + `.perf-chart-heading` for a chart,
  `.performance-table` for a table, `.performance-scope-toggle` or `.season-segment` for a segmented choice, the ranked-bar
  component (`src/components/BarChart.tsx`) for ranked bars, `teamLogoMarkup(team, number)` for team marks. These already carry the
  Linear rules in `skins.css`.
- **One system, no new layers.** `skins.css` is the single authority for the look: one token block, then the frame, rail,
  header and primitives. Never add a cascade layer, a version section ("v6") or a `[data-skin][data-skin]` selector to win a
  fight: find the rule that owns the look and change it. `scripts/test-linear-system.mjs` fails on all of these.
- **Layers beat specificity.** Stylesheets are cascade layers (`lib/ui-style-build.mjs`); `skins.css` is the last one, so its
  `:root[data-skin="linear"] …` rules win over anything in `car-performance.css`, `ui-controls.css`, `season.css` or
  `hig-system.css`, however specific. A new rule for an element that Linear rules already style (table cells, cards, buttons in
  the rail, bars) must go in `skins.css`, scoped with `:root[data-skin="linear"]`. A rule for a brand-new class can live with its
  component.
- **Tokens only.** Colours, radii and type come from tokens. Never a raw hex except a team colour.
- **Check both themes and phone width** (390 px) before calling it done, and run `npm run test:visual`.

## Type

Inter Variable, `font: <weight> <size>/<line-height> var(--ui-font)`. Numbers: `font-variant-numeric: tabular-nums`.

| Role | Rule | Example |
| --- | --- | --- |
| Page title | `600 24px/32px`, `letter-spacing: -.16px`, `--ui-label` | "Season", "Session overview", "Pace" |
| Card or chart title | `500 13px/1.4`, `--ui-tertiary` | "Lap times", "Title fight" |
| Row title, names | `500 13px`, `--ui-label` | drivers in tables, list rows |
| Card subtitle, body | `450 13px/18.2px` or `450 12px`, `--ui-tertiary` | "0 = best · …" (`.perf-chart-sub`) |
| Values in lists | `450–500 12px/1`, `--ui-secondary`; the important one in `--ui-label` | table cells, bar values |
| Big figure (insight tile) | `600 20px/1.2`, `--ui-label`, tabular | "1:35.130" |
| Table header | `450 12px`, `--ui-tertiary`, 32 px, no band | every table |
| Axis labels, tiny captions | `450 11px`, `--ui-tertiary` or quaternary, tabular | chart axes |
| Empty-state title | `600 15px/23px` | "Ready for analysis" |

Weights are the app's **450, 500 and 600** only. Sentence case everywhere, units included ("km/h", never "KM/H"); no
`text-transform: uppercase`.

## Colour roles

| Use | Token |
| --- | --- |
| Primary text | `--ui-label` |
| Secondary text, values | `--ui-secondary` |
| Labels, notes | `--ui-tertiary` |
| Axes, hints, disabled | `--ui-quaternary` |
| Card fill and border | `--lin-card` (`#191a1b`), `inset 0 0 0 1px var(--lin-card-border)` (`#222324`), `var(--lin-faint-shadow)` |
| Pills: fill / chosen / hover | `--lin-pill` (`#1b1c1d`) / `--lin-pill-on` (`#29292b`) / `--lin-pill-hover` |
| Rail text / property labels | `--lin-nav-text` / `--lin-prop-label` |
| Hairlines, chart grid | `--lin-hairline` |
| Hover wash / selected wash | `--lin-nav-hover` / `--lin-nav-active` |
| Pill ring | `--lin-label-border` |
| Gain / loss | `--ui-positive` / `--ui-negative` |
| Accent (primary action, focus) | `--ui-accent` |
| Identity | the team colour only (`teamColour`, `getDriverColor`). Never use team colour for selection or state. |

## Recipes

**Card (widget).** `border: 0; border-radius: var(--lin-card-radius); background: var(--lin-card); box-shadow: inset 0 0 0 1px
var(--lin-card-border), var(--lin-faint-shadow);` padding 12–16 px. Title per the type table, no divider under it. One level only:
a section that groups cards (`.dashboard-card`) is layout, never a card around cards. No drop shadows, no gradients, no glass.

**Insight readout** (`session-overview.js`). One flat property strip bounded by hairlines, rather than five separate cards.
Label (12 px tertiary), figure (600 20 px), team/code below (500 12 px secondary), then any note. Five columns when the
overview container is wider than 660 px; two below, with the final metric spanning the row. Cells use 16 px side padding.

**Team chip.** `teamLogoMarkup(team, number)`. 16 px for a swatch, **18 px when it carries a number** (the rail's size), so the
digits stay centred. Never put it inside a selector that restyles every `span`: the chip is a `span` with its own centred grid; style
the parent with a child combinator (`.tile > span`).

**Chart (SVG).** Inside a chart card. `overflow: visible`; grid lines `--lin-hairline` 1 px; axis labels 11 px 450 tertiary; data
lines 1.75 px (faint context series 1 px), round joins, straight segments (no curves); points 3.5 px with a 1.5 px card-coloured
ring (hollow for the second driver of a team colour); the selected point gets a `--ui-label` ring; end-of-line labels 500 11 px
in the series colour, at least 14 px apart. Strokes are non-scaling and sizes divided by `--chart-scale` where a chart has a fixed
viewBox. One rule set covers every chart: the chart block at the end of `skins.css` (and its twin in `season.css`). Scales enclose the data (round outer ticks, see `niceTicks`). Keep the viewBox
close to the rendered width so 11 px stays 11 px. A new fixed-viewBox chart must be listed in `svg-scale.js`'s selector, whose
scale is the fitted one (the smaller of width and height stretch when a height cap binds), and size text, strokes and `r`
against `--chart-scale` (see `svg.stint-plot`). Canvas telemetry follows the same type: axes `canvasFont(10)` (450 11 px),
in-chart labels `canvasFont(10, 500)`; its traces stay thinner than SVG lines (1.44 px reference, 1.12 px comparison)
because several laps overlap and precision matters. `node scripts/audit-charts.mjs` measures every chart at rendered size.

**Legend.** Linear's label pills: 24 px high, `border-radius: 9999px`, ring `--lin-label-border`, an 8 px colour dot, 500 12 px
secondary.

**Chart interaction.** Read-only values need keyboard access as well as pointer hover. Use one tab stop per plot, arrows to
move between values, Home/End for the first/last value, and Escape to dismiss the value card. Preserve the full measured
value, unit, uncertainty and provisional/missing status in accessible text. In Car performance, `data-chart-value` is a stable
identity (plot + entrant/round), not an empty marker; `dashboard-ui.js` owns navigation and the shared value card. Season's
`data-tip` marks use the same pattern, including the finishing-position histogram. A line over a transparent hit region
must not interrupt its tooltip. Keep value cards inside the viewport and avoid rescanning controls on each tooltip update.

**Repaint and loading.** Segmented choices and rebuilt selectors return focus to their replacement control. Load independent
Season datasets concurrently. Photo metadata and circuit outlines hydrate existing nodes after data renders, with credits;
they must not hold tables in a loading state or replace a table the user is interacting with.

**Small button** ("Show slow laps", "Change"). 24 px high, 0 9 px padding, `border-radius: 6px`, transparent, ring
`--lin-label-border`, 500 12 px tertiary; hover `--lin-nav-hover` + label colour with 0 s in and 0.15 s out; pressed
`--lin-nav-active`. Primary actions (Load session, Analyse): 28 px pills, padding 0 10, 500 12 white on the accent; they exist, reuse them.
View tabs and filter chips: 28 px pills filled `--lin-pill`, chosen `--lin-pill-on`, no ring.

**Segmented choice.** Reuse `.performance-scope-toggle` (Car performance) or `.season-segment` (Season); at 24 px inside cards,
28 px in toolbars. Do not hand-roll a new one.

**List rows inside a card** (e.g. "Where the time went"). 24 px rows, 6 px corners, hover `--lin-nav-hover`, negative 6 px side
margin so the wash reaches the card's padding. Label 500 12 px `--ui-label`, value tabular, coloured only when it is a gain or
loss.

**Table.** `.performance-table` / `.season-table`: header 32 px, 450 12 px tertiary, no band and no line; rows 44 px without
separators; hover `--lin-nav-hover`. Emphasis by colour tier (label / secondary / quaternary) and weight 600, not by cell
backgrounds (heat cells are data and keep their colour, 6 px corners). A coloured
6 px dot can mark a highlighted value. One alignment per column: identity columns left; number columns right for the title,
the value and any highlight alike (heat matrices of rounds centre all three). Sort titles are text, never filled pills: the
season sort button is classed `sort` in `ui-system.js` like `.perf-sort-btn`. The sort arrow hangs in the cell padding,
shown on hover/focus and on the sorted column, so it never shifts the title off its values. Long titles wrap inside their
column (bottom-aligned) rather than widening the table or spilling into the next column.

**Heat values in tables** (`heatChip()` in `season.js`). The value sits in a `.season-heat-value` chip, 24 px high, 6 px
corners, 0 8 px padding, minimum 40 px, inside the cell's normal padding, so neighbouring highlights keep a gap and nothing
clips. `--heat` (0–1) on the cell sets the chip's depth; no `--heat`, no fill. Do not reuse `.season-chip` (a bordered pill).

**Ranked bars.** One line per entrant: name, 6 px track (`--lin-bar`), value, all centred on the line; rows 32 px. The name
column is `minmax(84px, min(180px, 38%))`. The rows of one chart share their columns (`grid-template-columns: subgrid` on the
row, the columns on `.performance-bars`), so every bar in a chart has the same length whatever its value's width. Values use
500 12 px secondary; seconds per lap use 450 11 px tertiary before the percentage. Whiskers remain 1 px tertiary. A chart paired row-for-row with a table
retains its compact three-column layout and measured row heights. This is an Apex adaptation, not a measured Linear chart.

**Season data sections.** Tables occupy the page surface, with a quiet section heading and unfilled header. Chart widgets
retain the shared card surface. Standings places the primary table beside the title fight and charts at desktop widths;
the title fight precedes the table when stacked. Page titles name the selected Season view. Summary metrics share a flat
grid of property cells instead of individual dashboard cards.

**Contrast and accessibility.** Readable text meets 4.5:1: metadata uses `--ui-tertiary`; `--ui-quaternary` is for
decoration and disabled controls only. Coloured text on light tints is deepened (`color-mix(... #000)`), never re-hued; a
compound or team colour carried by a mark beside the word lets the word use a neutral. Accessible names start from the visible
text: add detail with `.visually-hidden`, not an `aria-label` that replaces it. A chart whose points are buttons is
`role="group"`, not `img`. Disclosure rows put `aria-expanded` on a real button. `node scripts/audit-a11y.mjs` runs axe,
a keyboard focus walk and a reduced-motion check on every route; `--browser firefox|webkit` runs any audit in another engine.

**Sticky columns.** A sticky name column paints `--season-surface` (content panel on desktop, canvas on phones, card inside
a card) so it reads as the surface it sits on. On phones the team sits under the name to keep the column narrow.

**Status and notes.** Empty states centred, 15 px 600 title, 13 px tertiary body. Inline hints 11–12 px quaternary.

## Layout and spacing

- 8 px between sibling cards, 12 px between stacked groups, 32 px between sections; content padding comes from the frame
  (`--linear-content-pad`), never set your own page margins.
- Everything must fit 390 px without horizontal page scroll: grids `auto-fit`/`minmax`, tables in their scroll wrap.
- Avoid layout shifts after data arrives: reserve space, or change layout only in response to a click (the browser test fails
  above a 0.1 layout-shift score).

## Checklist for a new element

1. Nearest existing element found and its rules reused?
2. Type only from the table above, colours only from the roles above?
3. Rules that compete with Linear rules placed in `skins.css`?
4. Team chips 18 px when numbered, not restyled by a parent `span` rule?
5. Dark, light and 390 px checked by screenshot; `npm run test:visual` reviewed?
6. `node scripts/audit-linear.mjs --quick` shows no new findings or component variants (`--only <state> --shots <dir>` for screenshots)?
