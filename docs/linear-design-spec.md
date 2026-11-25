# Linear design specification for F1 Apex Data

The single specification every visible element of this site follows. Every value says where it comes from:

- **[A] Verified in the app:** measured in the signed-in Linear web app on 2026-11-10 (Chrome, dark theme, 1043×959 viewport):
  the app's own CSS custom properties (593 read from `:root`) and computed styles of the sidebar, header, view tabs, issue list,
  projects table, project overview with its properties panel, the new-project dialog, empty states and a toast. **These win.**
- **[P] Published:** linear.app's public stylesheet tokens (`design/linear-tokens.json`) and Linear's design posts. Used where
  the app gives no value (notably the light theme, not inspected).
- **[M] Provisional:** the product replica on linear.app's homepage. A marketing embed: used only where neither [A] nor [P]
  covers a pattern, and replaced as soon as the app shows it.
- **[I] Inferred:** this site's decisions for things Linear has no equivalent for (telemetry charts, maps), derived from the rules
  above.

Where [M] and [A] disagree, [A] is right: the marketing site uses weights 510/590, the app 450/500/600; the replica's rail is
240,
the app's 244; replica cards are `#0f1011` with a black ring, the app's are `#191a1b` with a `#222324` border.

Sources: the signed-in app (workspace "apexdata") [A]; *A calmer interface for a product in motion* (2026-03-12) [P]; *How we
redesigned the Linear UI, part II* (2024-03-28) [P]; linear.app stylesheets [P]; linear.app homepage replica [M]. Background and
principles: [linear-design.md](linear-design.md). Building each element here: [linear-components.md](linear-components.md).

---

## 1. Colour and elevation

The app expresses every neutral in LCH with hue 272 and low chroma (0.4–1.5); hex below is the sRGB conversion.

### Surfaces, dark [A]

| Level | LCH L | Hex | Used for |
| --- | --- | --- | --- |
| Canvas (sidebar, frame, status bar) | 2.6 | `#09090a` | behind everything; the rail |
| Content panel | 5.5 | `#121213` | the raised view |
| Card / group band / dialog | 9.2 | `#191a1b` | property cards, list group headers, dialogs |
| Control fill | 10.1 | `#1b1c1d` | pill tabs, icon buttons, secondary buttons |
| Toast | 12.7 | `#202122` | toasts |
| Nav row selected / chip | 13.8–13.9 | `#232325` | selected rail row, property chips |
| Tab selected | 16.7 | `#29292b` | chosen view tab |
| bg-secondary / tertiary / quaternary | 7.3 / 8.2 / 9.3 | `#161617` / `#17181a` / `#1a1a1b` | app token scale |

### Lines, dark [A]

border-primary L9.8 `#1a1b1d` (panel border); card border L13.6 `#222324`; outline card L14.2 `#232426`; border-secondary L14.2
`#232426`; border-tertiary L16.3 `#28282b`; strong outline L17.9 `#2b2c2e`.

### Text, dark [A]

| Tier | LCH L | Hex | Use |
| --- | --- | --- | --- |
| primary | 100 | `#ffffff` | titles, row titles, selected tabs and rows |
| secondary | 90.5 | `#e3e4e6` | values, property values, group labels |
| tertiary | 61.8 | `#959597` | ids, dates, descriptions, table headers, unselected tabs |
| nav text | 60.6 | `#929294` | rail rows and rail section labels |
| quaternary | 37 | `#565759` | hints, disabled |

### Accent [A]

brand / focus `#5e69d1` (L47.9); focus ring 1 px solid `#5e69d1`; selection: brand at 40%.

### Elevation [A]

| Surface | Fill | Border | Shadow | Radius |
| --- | --- | --- | --- | --- |
| Content panel | `#121213` | 1 px `#1a1b1d` | `0 .5px 1px 1px` black 30% (barely visible) | 12 |
| Card | `#191a1b` | 1 px `#222324` | same faint shadow | 10 |
| Outline card (empty / add) | none | 1 px `#232426` | — | 10 |
| Dialog | `#191a1b` | — | layered: `0 4px 40px` black 10%, `0 3px 20px` 12.5%, `0 3px 12px` 12.5% | 21 outer, 12 inner |
| Toast | `#202122` | — | — | 12 |

### Light theme [P]

Not inspected in the app. Use Linear's published light tokens: canvas `#f9f8f9`, content `#ffffff`, cards `#ffffff` with a
`#00000014` border, text `#282a30` / `#3c4149` / `#6f6e77` / `#86848d`, brand `#7070ff` (darkened here to `#6563f1` for
contrast). Same structure and radii as dark.

## 2. Typography [A]

Inter Variable, `cv01 ss03`. **Weights: 450 normal, 500 medium, 600 semibold** (700 bold exists, unused). Sizes from the app:
micro 11 (rounded up to 12 in places), mini 12, small 13, regular 15, large 18, title3 20, title2 24, title1 36.

| Role | Spec | Evidence |
| --- | --- | --- |
| Page title | 600 24/32, −.16 px, primary | [A] project title |
| Empty-state title | 600 15/23, secondary | [A] |
| Card / widget title | 500 13, tertiary, foldable caret | [A] "Properties", "Milestones", "Activity" |
| Section label (in page) | 500 13, tertiary | [A] "Description", "Resources" |
| Rail row | 500 13, nav text; selected primary | [A] |
| Rail section label | 500 12, nav text | [A] "Workspace" |
| Breadcrumb | 500 13 primary (current), tertiary (parents) | [A] |
| View tab | 500 12 | [A] |
| Row title | 500 13 primary | [A] |
| Row id / meta / date | 450 13 (ids, −.26 px) and 450 12, tertiary | [A] |
| Table header | 450 12 tertiary | [A] |
| Table number | 450 12 primary | [A] |
| Property label / value | 450 12 (`#99999b`) / 500 13 secondary | [A] |
| Body, descriptions | 450 13/18.2 tertiary | [A] empty-state body |
| Button | 500 12 | [A] |
| Chip | 500 12/12 | [A] |
| Axis labels | 450 11 tertiary | [I] |

## 3. Spacing and sizing [A]

- Sidebar **244** wide; rows **28**, radius 8, padding `0 9 0 8`; section labels at 12 px.
- Content panel inset: **8** top and right from the canvas, **36** at the bottom for the status bar; starts at the sidebar's edge.
- Header row 52 (breadcrumb centred at 30; 28 px buttons); view-tab row 28 pills from y 60; content from y 96.
- Pill tabs, primary and secondary buttons, icon buttons: **28** high; chips **24**; property rows 36.
- Issue rows **44**; table rows **48**; table header **32**; group header **36**.
- Card padding 12; outline card padding 16; content side padding ≈ 58 on detail pages (title at x 303 in a panel at 245).

## 4. Radii [A]

Control radius **8** (`--control-border-radius`); nav rows 8; group band 8; cards **10**; panel, toast and dialog inner **12**;
dialog outer 21; pills and icon buttons **9999**.

## 5. Sidebar and navigation [A]

On the `#09090a` canvas, no fill or border. Top: workspace switcher (20 px avatar, 600 13 name), search and compose as 28 px round
buttons. Rows 28, radius 8, 16 px icons, 500 13 nav text; selected row filled `#232325` with white text; hover a faint wash.
Section labels (Workspace, Your teams, Try) 500 12 nav text with a caret; team items indent 16 with their own children indented
again. Counts right-aligned 450 12. A status bar sits under the panel (36 high) with the agent and history buttons.

## 6. Header and toolbar hierarchy [A]

- Header (52): breadcrumb (parents tertiary, current primary, `›` separators), favourite star and overflow; right: page actions
  as transparent 28 px round icon buttons and one text action ("New issue", 500 12 tertiary with a + icon).
- View row (28): view tabs as pills (unselected `#1b1c1d` + tertiary text, selected `#29292b` + primary), a view-options icon;
  right: filter, display options and panel toggle as 28 px round icon buttons filled `#1b1c1d`.
- Actions sit in the same place on every page [P].

## 7. Page layout templates [A]

- **List view:** header, view row, then rows edge to edge in the panel (no cards), grouped under 36 px rounded bands.
- **Table view:** header, view row, a 32 px header row (no band), 48 px rows, no separators.
- **Detail view:** main column (title 24, properties, sections) and a right-hand column of stacked property cards (10 px
  radius, 12 padding, 8 px apart).
- **This site:** Session and Car performance are detail views (analysis column + right-hand inspector of cards); Season tabs are
  list/table views; charts sit in cards.

## 8. Component anatomy and states [A unless marked]

| Component | Anatomy | States |
| --- | --- | --- |
| Rail row | 28, r 8, icon 16, 500 13 | hover wash; selected `#232325` + white |
| Icon button | 28 circle; header: transparent; view row: `#1b1c1d` | hover lighter fill |
| View tab | 28 pill, padding 0 10, 500 12 | unselected `#1b1c1d` tertiary; selected `#29292b` primary |
| Primary button | 28 pill, padding 0 10, 500 12 white on `#5e69d1`, faint shadow | hover lighter |
| Secondary button | 28 pill, padding 0 10, 500 12 secondary on `#1b1c1d` | hover lighter |
| Chip (property) | 24 pill, padding 0 8 0 6, 500 12 `#99999b` on `#232325`, icon 14 | hover lighter |
| Card | `#191a1b`, 1 px `#222324`, r 10, padding 12, faint shadow; title 500 13 tertiary with caret and a trailing + | — |
| Outline card | transparent, 1 px `#232426`, r 10, padding 16 | hover fill |
| Group band | 36, r 8, `#191a1b`, label 500 13 secondary + count tertiary | — |
| List row | 44, no separator; id 450 13 tertiary, title 500 13 primary, meta 450 12 tertiary | hover wash, selected fill |
| Table | header 32, 450 12 tertiary, no band; rows 48, no separators; numbers 450 12 primary | row hover wash |
| Property row | 36, label 450 12 `#99999b` (fixed column), value 500 13 secondary | hover on value |
| Toast | 384 wide, `#202122`, r 12, 13 px text | — |
| Dialog | r 21 outer, `#191a1b`, layered shadow; breadcrumb 500 12 in its header | appears with fade |
| Empty state | illustration, title 600 15/23 secondary, body 450 13/18.2 tertiary, primary + secondary pills | — |
| Focus | 1 px solid `#5e69d1` | — |

## 9. Interaction and motion [A][P]

Highlight in 0 s, out 0.15 s; quick 0.1 s; regular 0.25 s; slow 0.35 s [A tokens]. Ease-out-quad for UI [P]. No bounce.
`prefers-reduced-motion` removes movement.

## 10. Responsive behaviour [I]

Linear's web app collapses the sidebar on narrow windows; no breakpoints are published. Here: ≥ 761 px the frame with rail;
below, the rail becomes a top strip, the panel is full-bleed with 16 px gutters, cards stack, tables and wide charts scroll
inside their card. Touch targets 44 px on phones [P].

## 11. Charts and telemetry [I]

Series keep meaningful colours (team identity, F1 timing colours). Everything around them follows this spec: a card per chart
(§1), card title 500 13 tertiary, axes 450 11 tertiary on hairline grids, legends as chips, tooltips as toasts' surface
(`#202122`, r 12), text and strokes at real pixel size.
