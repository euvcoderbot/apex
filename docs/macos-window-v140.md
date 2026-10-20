# macOS window redesign — v140

This release turns the dashboard into a macOS-style *window*: a unified toolbar, a source-list sidebar beside the content, grouped content boxes and AppKit-like control metrics. It's presentation only. No measurement, eligibility, ranking or cache-key logic changed, and `car-performance.js`, `app.js` and `speed-domain.js` aren't touched.

## Structure

| Area | Before | Now |
| --- | --- | --- |
| Window chrome | Tall header with a wordmark; display tools moved between page intros | 52 px unified toolbar: sidebar item, app icon, window title and subtitle (leading); Session / Car performance segmented control (centre); local-compute status, explanations and appearance items (trailing). Translucent toolbar material with a hairline separator. |
| Session analysis | Session form as a full-width card above the work area; drivers rail only at ≥1440 px | Sidebar (≥980 px) holds the Session pop-ups, the Load action and the driver source list (position, team colour bar, logo, name/code, check mark). The content column holds the lap chooser and the telemetry stack. Below 980 px the sidebar stacks above the content and drivers return to the lap chooser. |
| Car performance | Setup card and a horizontal tab strip of emoji labels | Sidebar holds Season, Scope, Analyse/Stop and the race checklist, followed by a **Categories** source list with line icons. Content shows a large category title, controls and load count on one row, and *Refresh data* as a toolbar action. |
| Page title | Visible eyebrow + H1 | The H1 stays in the DOM for assistive technology. The toolbar shows the visible title. |

The category source list mirrors the original `role="tablist"` in `#performanceResults`, and clicking a row calls `.click()` on the original tab. So `car-performance.js` still owns all metric state, keyboard handling and rendering. On wide windows the original strip is hidden with CSS, and below 980 px the list becomes a 4- or 2-column grid.

## Stylesheet ownership

A new final cascade layer, `window` (`macos-window.css`), sits after `components` (`ui-controls.css`). `ui-controls.css` still defines the semantic tokens. They're updated to AppKit-like dynamic colours: label, secondary, tertiary, quaternary, sidebar, toolbar, content, separator, row-alt, selection and segment track/thumb, with separate light and dark values. The layer order is `focus → legacy → interface → workspace → appearance → components → window`.

## Element changes

- **Typography:** SF Pro Text/Display first, then Segoe UI Variable and the system UI font. 12 px data, 13 px source-list rows, 11 px section headers and captions, a 22 px category title and tabular figures for all timing values.
- **Controls:** 26 px regular controls. Push and pop-up buttons use bezel shadows instead of outlines. Pop-up buttons show the paired up/down chevrons of `NSPopUpButton`. Menus have 24 px rows with a leading check mark, a blur material and a 120 ms open animation. Segmented controls use a recessed track and a raised thumb.
- **Selection:** Sidebar rows use an accent-tinted rounded selection plus a weight change. Driver rows add a filled check mark, so selection doesn't depend on colour alone.
- **Tables:** These follow `NSTableView`: sticky 26 px header, 26 px rows, zebra striping, hover row and no vertical rules. Caption text sits under the value. Split chart + table views let the table keep its natural width up to 62 %, and the chart takes the rest.
- **Charts:** These have a well surface with a hairline border, 6 px bar tracks, 26 px rows aligned with table rows, and compact 30 px development sparklines.
- **Warnings:** More than two "incomplete or unavailable" source messages collapse into one disclosure (*N sessions are incomplete or unavailable*) with the full list inside, so they no longer fill the top of every category.
- **Disclosures:** These use the macOS disclosure triangle, which rotates 90° when open. Content reveals with a short fade.
- **Empty and loading states:** Line-symbol empty states, with the status line under the toolbar acting as the window's status bar.
- **Appearance:** The appearance follows the system until the person uses the appearance item. That choice is stored as before, and per-colour-scheme `theme-color` metas tint browser chrome.
- **Motion:** 140 ms state transitions, a 180 ms view cross-fade, a 240 ms sidebar collapse and the menu/sheet entrances. Panels re-rendered during loading are deliberately not animated. Reduced Motion disables all of these.
- **Accessibility:** Focus rings use a 3 px accent halo, and coarse pointers get 44 px targets. Reduced Transparency and Increased Contrast make the materials opaque and add selection outlines. Forced-colours mode uses system colours.

## Verification

- `node --test scripts/test-*.mjs`: all JS tests pass. Tests that asserted the old header, the 1440 px driver rail, the 30 px control height and the six-layer bundle were updated to assert the new contract. `scripts/test-macos-window.mjs` adds coverage for the toolbar and sidebar structure, the system-appearance default, category delegation, a sidebar toggle run in a minimal DOM, the accessibility fallbacks and the sidebar contrast in both appearances.
- Browser checks on the local dashboard:
  - **Session analysis:** checked at 1440 × 900 in dark and light, with Singapore 2026 Qualifying loaded and VER/LEC fastest laps compared.
  - **Car performance:** all eight categories checked at 1440 × 900 in dark, plus Pace and Cornering in light.
  - **Narrower widths:** the Tracks scope and sidebar toggle at 1100 px, the stacked layout at 768 px and both views at 375 px.
  - **Overflow:** no page-level horizontal overflow was found at these sizes.
- Limits: browsers can't sample the desktop behind the window for true vibrancy, SF fonts render only where installed, and scrollbars stay browser-controlled.
