# Linear design reference

Everything Linear has published about its design, plus what linear.app itself uses, in one place: the reference for every
visual decision on this site. Read it before any UI work, with [linear-components.md](linear-components.md) (how to build each
element here) and [linear-look.md](linear-look.md) (how the look is wired into this codebase).

- **Raw tokens:** [`design/linear-tokens.json`](../design/linear-tokens.json), every custom property linear.app declares on `:root`,
  `[data-theme="dark"]` and `[data-theme="light"]`. Refresh with `node scripts/fetch-linear-tokens.mjs` and review the diff.
- **Sources** (read 2026-11-10): Linear's stylesheets on linear.app (46 sheets); computed styles of linear.app's own pages and its
  embedded product demo; *How we redesigned the Linear UI (part II)*, Karri Saarinen, Yann-Edern Gillet, Andreas Eldh, Romain
  Cascino, 2024-03-28; *A calmer interface for a product in motion*, Charlie Aufmann and Maxime Heckel, 2026-03-12; *A Linear spin
  on Liquid Glass*, Robb Böhnke, 2025-10-21; linear.app/brand. The signed-in product app was not inspected.
- Linear's logo, wordmark, icon and illustrations are proprietary (linear.app/brand): never used here. This site borrows the
  design language, not the brand.

---

## 1. Principles (what Linear says it is doing)

Paraphrased from the posts above, with what each means for this site.

| Principle | What Linear says | What it means here |
| --- | --- | --- |
| **Don't compete for attention you haven't earned** (2026) | Not every element carries equal weight. What the task needs stays in focus; orientation and navigation recede. The sidebar was dimmed a few notches; tabs made compact; icons reduced, scaled down, coloured icon backgrounds removed. | The rail and headers stay in tertiary text, quaternary icons. Data (traces, numbers) carries the contrast. No coloured icon tiles; team colour only marks identity. |
| **Structure should be felt, not seen** (2026) | Borders and separators had multiplied; they were softened in contrast and rounded, and many removed. | Prefer spacing and a faint card ring over lines. One hairline at most between groups. Never a border inside a bordered card. |
| **The inverted L** (2024) | Sidebar and top bar are the global chrome on the canvas; the content is one raised panel controlled by them. | The rail and location header frame one raised content view (`skins.css`, frame section). |
| **Felt alignment** (2024) | Labels, icons and buttons in the sidebar and tabs aligned vertically and horizontally; "something you'll feel after a few minutes". | Every row in a list has the same height and the same left edge; icon and text centres line up; numbers are tabular and right-aligned. |
| **Hierarchy through few levels** (2024) | Explorations used only black and white opacities to express elevation and hierarchy; the system is a set of variables with operations on them. | Four text tiers and four surface levels, nothing in between. Translucent white/black for hover, selected and rings. |
| **Themes from three variables** (2024) | Light and dark are generated, like custom themes, from base colour, accent colour and contrast, in LCH (perceptually uniform), instead of 98 hand-set variables; contrast can be raised for accessibility. | Our palette is Linear's generated output; `prefers-contrast: more` raises contrast the way their contrast slider does. |
| **Neutral and timeless** (2024, 2026) | Less "chrome" (blue) mixed into the neutrals; 2026 moved further from cool blue-grey towards a warmer, less saturated grey that still feels crisp. | Neutrals are near-grey; the accent appears only on primary actions, focus, selection and links. |
| **Contrast of content** (2024) | Text and neutral icons darker in light mode, lighter in dark mode. | Primary text `#f7f8f8` / `#282a30`; never dim data below the tertiary tier. |
| **Inter Display for headings** (2024) | Inter Display adds expression to headings; regular Inter for everything else. | Inter Variable with the optical-size axis (Display shapes at heading sizes), `cv01` and `ss03`. |
| **Professional, not consumer** (2025) | For dense professional work they take glass's depth but with a "ProKit" discipline; refraction rejected because it hurts reading in dense interfaces; Increase Contrast draws solid outlines. | No glass, blur or refraction in the content. High contrast mode turns rings into solid borders. |
| **Prune continuously** (2026) | Products degrade one reasonable feature at a time; consistency (e.g. header actions always in the same place) has to be restored deliberately. | New features must reuse existing patterns and positions (toolbar actions right, filters left, etc.). |
| **Most of what makes it good is invisible** (2026) | If people don't notice what changed, that is a good sign. | Changes should look like they were always there. |

---

## 2. Colour

Linear's two themes, exactly as published (`design/linear-tokens.json`). **Bold** = what this site uses for that role.

### Surfaces

| Token | Dark | Light | Role here |
| --- | --- | --- | --- |
| `bg-level-0` / `bg-primary` | `#08090a` | `#ffffff` | **canvas** (frame behind the rail) in dark |
| `bg-level-1` / `bg-panel` | `#0f1011` | `#f8f8f8` | **raised content view** (`--ui-panel`) |
| `bg-level-2` / `bg-tint` | `#141516` | `#f4f4f4` | wells, inputs |
| `bg-level-3` | `#191a1b` | `#f0f0f0` | hover on a well |
| `bg-secondary` | `#1c1c1f` | `#f9f8f9` | menus, popovers; light canvas |
| `bg-tertiary` | `#232326` | `#f4f2f4` | control hover |
| `bg-quaternary` | `#28282c` | `#eeedef` | selected control |
| `bg-quinary` | `#282828` | `#e9e8ea` | pressed |
| `bg-translucent` | `#ffffff0d` | `#00000005` | faint fills on any surface |
| `bg-marketing` | `#010102` | — | marketing pages only |

### Text and foreground

| Tier | Dark | Light | Use |
| --- | --- | --- | --- |
| primary | `#f7f8f8` | `#282a30` | titles, data, selected rows |
| secondary | `#d0d6e0` | `#3c4149` | body, values, row labels |
| tertiary | `#8a8f98` | `#6f6e77` | labels, metadata, inactive nav |
| quaternary | `#62666d` | `#86848d` | axes, hints, placeholders, icons at rest |

### Lines and borders

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `border-translucent` | `#ffffff0d` | `#0000000d` | **hairlines** inside the view |
| `border-translucent-strong` | `#ffffff14` | `#00000014` | **card rings**, header border, frame |
| `border-primary` | `#23252a` | `#e9e8ea` | opaque divider |
| `border-secondary` | `#34343a` | `#e4e2e4` | control border |
| `border-tertiary` | `#3e3e44` | `#dcdbdd` | label pills (`--lin-label-border`) |
| `line-primary` … `line-quaternary` (2026) | `#37393a #202122 #18191a #141515` | `#d4d4d6 #eaeaeb #f0f0f0 #f4f4f4` | the softened separators: secondary for list separators, tertiary/quaternary for barely-there structure |
| `line-tint` | `#141516` | `#f4f4f5` | tinted separators |

### Accent, brand and status

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `brand-bg` | `#5e6ad2` | `#7070ff` | primary button fill (light darkened here to `#6563f1` for 4.5:1 white text) |
| `accent` | `#7170ff` | `#7170ff` | accent text, focus, active indicators |
| `accent-hover` | `#828fff` | `#8989f0` | hover on accent |
| `accent-tint` | `#18182f` | `#f1f1ff` | accent-tinted backgrounds (mention chips, selected accent buttons) |
| `link-primary` / hover | `#828fff` / `#fff` | `#7070ff` / text primary | links |
| selection | brand mixed 10% black (dark), brand at 36% (light) | | text selection |
| `button-invert-bg` | `#e5e5e6` (hover `#fff`) | `#282a30` (hover `#1f2024`) | the high-emphasis inverted button ("Sign up") |
| red / green / yellow / orange | `#eb5757` / `#27a644` / `#f0bf00` / `#fc7840` | same (darkened here in light for contrast) | loss / gain / warning / attention |
| indigo / teal / blue | `#5e6ad2` / `#00b8cc` / display-p3 `.431 .682 .999` | | spare categorical colours |
| overlay | `#000000d9` | `#ffffffa6` | dialog backdrop |
| brand neutrals | Nordic Gray `#222326` | Mercury White `#F4F5F8` | brand page only; not used in the app |

**Rules.** Colour never carries hierarchy (tiers do). The accent is rare. Team colours mark identity only (a dot, a line, a
swatch), never selection or state. Translucent white/black for hover (`~2–4%`), selected (`~4–8%`) and rings (`5–8%`).

---

## 3. Typography

Font: **Inter Variable** (Linear: `"Inter Variable", "SF Pro Display", -apple-system, …`); monospace **Berkeley Mono** (fallback
`ui-monospace, "SF Mono", Menlo`); serif display *Tiempos Headline* (marketing only). Features `"cv01", "ss03"` on `body`;
`-webkit-font-smoothing: antialiased`. Numbers in data: `font-variant-numeric: tabular-nums`.

**Weights:** 300 light · 400 normal · **510 medium** · **590 semibold** · 680 bold. The interface uses 400, 510 and 590.

**Sizes** (Linear's named scale): micro 11 · mini 12 · small 13 · regular 15 · large 18 · title3 20 · title2 24 · title1 36 px.

**Text styles** (size / line height / letter spacing):

| Style | Value | Use here |
| --- | --- | --- |
| text-tiny | 10 / 1.5 / −.015em | badges only |
| text-micro | 12 / 1.4 / 0 | labels, captions, table headers, values in dense lists |
| text-mini | 13 / 1.5 / −.01em | **base UI text** (rows, buttons, inputs) |
| text-small | 14 / 1.5 / −.013em | longer UI text |
| text-regular | 15 / 1.6 / −.011em | prose, descriptions |
| text-large | 17 / 1.6 / 0 | lead paragraphs |
| title-1 | 590 17 / 1.4 / −.012em | small headings |
| title-2 | 590 20 / 1.33 / −.012em | **page and section titles** ("Lap telemetry") |
| title-3 | 590 24 / 1.33 / −.012em | big figures, hero titles |
| title-4 … title-9 | 590 32 / 40 / 48 / 56 / 64 / 72, letter-spacing −.022em | marketing; not used in the app |

Measured on linear.app: sidebar rows 510 13 px secondary; section labels 510 12 px quaternary; body copy 400 15/24 tertiary;
section headings 510 24/32 with −.012em; buttons 510 13 px.

---

## 4. Shape, depth, spacing, layers

| Thing | Linear | Use here |
| --- | --- | --- |
| Radii | 4 · 6 · 8 · 12 · 16 · 24 · 32 · 9999 · 50% | 4 inline chips and code; **6 small buttons and controls**; **8 cards, rows, menus**; 12 dialogs and panels; 9999 pills; 50% dots and avatars |
| Hairline | 0.5 px (`--border-hairline`) on high-DPI | 1 px rings via `box-shadow: inset 0 0 0 1px` |
| Shadows (dark) | low `0 2px 4px #0000001a`; medium `0 4px 24px #0003`; high `0 7px 32px #00000059` | **cards: none** (ring only); menus/popovers: medium; dialogs: high |
| Shadows (light) | tiny `0 1px 1px #00000017`; low `0 1px 4px -1px #00000017`; medium `0 3px 12px #00000017`; high `0 7px 24px #0000000f` | same roles |
| Stacked shadow | `shadow-stack-low` (five layers, light adds an inset bottom edge) | the inverted primary button |
| Layers (z) | footer 50 · scrollbar 75 · header 100 · overlay 500 · popover 600 · command menu 650 · dialog overlay 699 · dialog 700 · toasts 800 · tooltip 1100 · context menu 1200 | keep this order for any new floating element |
| Page | max 1024 px, prose 624 px, inline padding 24 px, block 64 px, header 64 px with 20 px blur (marketing) | the app view uses the frame's own sizes (rail 240 px, header 44 px, content padding 28 px) |
| Tap size | 44 px minimum | touch targets on phones |
| Scrollbars | 6 px thumb (10 px active), 4 px gap; colour white/black 10%, 20% hover, 40% active | `skins.css` scrollbars |

**Spacing** follows a 4 px grid: 2 (between rows), 4, 6, 8 (between cards), 12, 16 (card padding), 20, 24 (section gaps),
28–32 (content padding, between sections).

---

## 5. Motion

| Token | Value | Use |
| --- | --- | --- |
| highlight fade in / out | 0 s / 0.15 s | hover: appears instantly, fades out |
| quick transition | 0.1 s | menus, small state changes |
| regular transition | 0.25 s | larger moves |
| measured on linear.app | buttons 0.16 s; header 0.1 s; menus scale .9→1 + fade 100 ms; tooltips 120 ms; dialogs scale .96 + fade 175 ms | |
| Easing | ease-out-quad `cubic-bezier(.25,.46,.45,.94)` (default); ease-in-quad `(.55,.085,.68,.53)`; ease-out-cubic, -quart, -quint, -expo, -circ and in-out variants are all defined | ease-out-quad for UI; never bouncy |

Frequent navigation has no entrance animation. `prefers-reduced-motion` removes movement. Mobile (2025): press lifts slightly;
not used on the web.

---

## 6. Focus and accessibility

- Focus ring: dark 1 px solid (Linear's focus colour), light 2 px `#0006`, offset 2 px. Measured on inputs: `0 0 0 3px
  rgba(94,106,210,.4)` (brand at 40%) with a 6 px radius.
- Increase contrast: Linear draws solid outlines around translucent surfaces and raises text contrast; here
  `prefers-contrast: more` makes rings solid and moves secondary-to-quaternary text toward primary.
- Text contrast: 4.5:1 for text; Linear's light accent and brand were darkened here where they missed it (see
  linear-look.md).
- Cursor: Linear keeps `default` on most interactive UI (`--pointer: default`) and `pointer` on links; `help` for tooltips;
  `not-allowed` for disabled.

---

## 7. Components measured on linear.app

Computed styles of linear.app pages and its embedded product demo (dark theme). Heights in px.

| Component | Measurements |
| --- | --- |
| Sidebar row (product demo) | 28 h (rows ~28), padding 0 7, radius 8, 510 13 px `#d0d6e0`; active background white 4% |
| Sidebar section label | 510 12/14 quaternary `#62666d`, padding 4 0 4 6, with a disclosure caret |
| Label pill (e.g. a project label) | ~24 h, radius 16 (pill), 1 px border `#2e2e32`, padding 0 11 0 7, 400 12/14 secondary, a colour dot first |
| Inline code chip | radius 4, background white 5%, 1 px border white 8%, padding 1.2 6, 12 px |
| Mention chip | radius 4, padding 0 3, accent text on accent at 15% |
| Card / popover | background `#0f1011`, radius 9, `0 0 0 1px rgba(0,0,0,.2)` outside plus a 1 px white-8% border, padding 12 0 |
| Comment bubble | background `#161718`, radius 8, padding 10, 400 13/20 primary, ring black 20% |
| Header nav button | 32 h, padding 0 12, radius 9999, 400 13/19.5 tertiary; hover to primary, 0.1 s ease-out-quad |
| Primary marketing button ("Sign up") | 32 h, padding 0 12, radius 9999, 510 13 px, inverted (`#e5e5e6` fill, `#08090a` text), stacked low shadow, 0.16 s transitions |
| Large buttons | 44 h, padding 0 20, radius 9999, 510 16 px; secondary is white 5% fill with a 3% inset ring |
| Icon button | radius 9999 or 6, quaternary icon, white 2% fill and 1 px `#24282c` border when outlined |
| Avatar | circle, 5% white fill placeholder |
| Headings on marketing | h1 510 38/42 −.022em; h2 510 24/32 −.012em; lead 400 15/24 tertiary |
| Focus ring on an input | 3 px brand at 40%, radius 6 |

From the product write-ups: tabs compact with rounded corners and smaller icons and text (2026); notifications grouped by type
with faces emphasised (2024); headers hold filters and display options; side panels hold properties; views are list, board,
timeline, split and fullscreen.

---

## 8. How this site applies it

| Linear | This site |
| --- | --- |
| Inverted L, sidebar + top bar on canvas | `#linearWorkspace` rail (240 px) + 44 px location header around one raised view (`skins.css`) |
| Sidebar rows 28 px, 510 13 px, radius 8 | rail navigation, drivers list, categories |
| Section labels 510 12 px quaternary | rail section headings |
| Views with headers for filters and display options | session selectors, Car performance scope and races, Season tabs |
| Side panel for properties | the track and corner inspector |
| List rows, hairline separators | `.performance-table`, `.season-table` |
| Cards: panel fill, ring, radius 8 | charts, lap cards, overview tiles, profile, time summary |
| Label pills | comparison laps, chart legends |
| Small controls 24–28 px | toggles, segmented controls, CSV, Change |
| Primary action in brand colour | Load session, Analyse |
| Accent tint | per-driver Fastest pick |
| Status colours | gains/losses, warnings |
| Structure felt not seen | no borders inside cards; one hairline between groups; spacing first |

Where this site needs something Linear doesn't publish (telemetry traces, bar charts, maps), it follows the same rules: hairline
grid, quaternary axes at 11 px, 510 12 px values, team colour only for identity, data in the strongest contrast.
