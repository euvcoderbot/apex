# Selection, highlight and list spec (Apple HIG) — 2026-10-22

Audit of the running site (Bahrain 2026 Q, VER L11 vs HAM L14) found six different ways of showing "selected":

| Today | Where |
| --- | --- |
| Blue inset ring (outline look) | Driver rows, reference lap chip, menu items |
| Team-tinted fill + ring | Q1/Q2/Q3 runs, lap tiles, "Fastest" pick |
| Grey raised thumb | Segmented controls, "Compare fastest" |
| Solid accent fill | Corner / straight picks |
| Accent tint 16–22 % | Sidebar race list, category tabs (plus accent underline) |
| Team-coloured border | Visible-trace chips |

None of these conflict with the data, but together they read as inconsistent, and the ring style is what macOS uses for **keyboard focus**, not selection.

## Rules

1. **Rings mean focus only.** A 3 px accent focus ring on `:focus-visible`; never an outline, border or inset ring to show selection.
2. **Team colour is identity, never state.** Team colour appears only as the 3 px identity bar, dot, logo or trace colour; it never tints a selected control.
3. **One selected style per control family:**

| Family (HIG) | Controls in this app | Selected | Unselected / hover |
| --- | --- | --- | --- |
| **List / sidebar row** | Driver list, race list (Tracks), pop-up menu items, narrow category grid | Rounded 6 px row filled with the selection colour (`--ui-selection`), white label, white 80 % secondary text, white trailing checkmark when multi-select | Transparent; hover `--ui-row-hover` |
| **Segmented control** (mutually exclusive) | View switch, Teams/Drivers, Qualifying/Race, Mean/Median…, **Q1/Q2/Q3 runs**, category bar on wide windows | Raised thumb (`--ui-seg-thumb`, small shadow), label semibold | Recessed track, secondary label |
| **Toggle button / tile** (on/off, multi-select) | Lap tiles, corner & straight picks, "Fastest" pick, "Compare fastest" | Accent fill (`--ui-action`), white label | Control bezel (`--ui-control` + shadow); hover `--ui-control-hover` |
| **Checkbox** | Corner numbers, speed annotations, visible traces | Accent-filled circle with white check (current) | Hairline circle |
| **Tag / badge** (not a selection) | REF | Accent tint badge only; the chip itself stays neutral | — |

4. **Category bar**: use the segmented thumb (as the view switch), drop the extra accent underline; keep the coloured symbol tiles.
5. **Visible-trace chips**: neutral bezel chip; the checkbox shows on/off, the colour well shows the trace colour; no team-coloured border.

## Driver list as a macOS source list

macOS sidebars and source lists (Finder, Mail, Music) use compact single-line rows, natural-case labels and filled selection:

- **Row**: 32 px, single line — position (tabular, tertiary, right-aligned 2-digit column) · team logo 18 px · name in natural case ("Max Verstappen", not "Max VERSTAPPEN") · trailing code (`VER`, tertiary). Car number moves to the tooltip.
- **Selection**: filled selection-colour row with white text, as above. Multi-select keeps every selected row filled; adjacent selected rows sit 2 px apart so each stays distinct. Replace the hollow circle on unselected rows with nothing; selected rows show a white checkmark at the trailing edge.
- **No borders or rings** around rows; hover is a subtle fill.
- **Race sessions**: trailing points or gap (as today) replace the code; still one line.
- **Section header** "Drivers" stays as the sidebar group label (13 px semibold, secondary).

## Implementation notes for the restructure (React components)

- `ListRow` (driver, race, menu item): `selected`, `multi` props → selection fill + trailing check; no ring.
- `SegmentedControl`: used for runs (Q1/Q2/Q3) as well as existing segments.
- `ToggleTile`: lap tiles, corner/straight picks, fastest picks → accent fill when on.
- `Badge`: REF.
- Tokens: `--ui-selection`, `--ui-action`, `--ui-seg-thumb`, `--ui-row-hover`, `--ui-focus` (already in `ui-controls.css`). Light appearance uses the same rules with the light tokens.
- Keep `aria-pressed` / `aria-selected` / `aria-current` semantics as they are; only the visuals change.
