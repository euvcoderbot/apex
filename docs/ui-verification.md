# UI verification

Two repeatable checks guard the interface. Both run the production stylesheet and scripts; neither has demo-only components.

## Behaviour and budgets (`npm run test:e2e`)

Playwright runs `e2e/catalog.spec.mjs` and `e2e/shell.spec.mjs` in Chromium, Firefox and WebKit (CI runs all three on Linux).

- **Catalogue** (`ui-catalog.html`): every section renders, no control lacks a design-system owner, keyboard operation of tabs, pop-up menu, sheet and popover (Escape, arrow keys, focus return), one sliding thumb per segmented control that reverses cleanly, reduced motion removes transitions, reduced transparency and increased contrast replace translucent materials with opaque ones (Chromium only: the protocol is the one way to emulate `prefers-reduced-transparency`), keyboard focus is visible.
- **Application shell** (`/apex/` with the network faked): download, DOM and layout-shift budgets for the session view, Car performance is not fetched before the page has loaded, opening it updates route and title, a shared `/apex/cars/braking?year=2026` link keeps its category and year, the toolbar selectors work from the keyboard.

Budgets sit just above today's numbers (session view: about 154 KB of script gzipped, 68 KB of CSS). They catch regressions; they are not targets. Each run attaches a `metrics.json` per browser.

## Screenshots (`npm run test:visual`)

`e2e/visual.spec.mjs` compares every catalogue section in dark and light, materials with reduced transparency and increased contrast, touch target sizes, and the application shell at 1440, 1024 and 390 px in both appearances.

Screenshots are drawn by the machine that takes them, so baselines are per operating system and per browser (`e2e/__screenshots__/{platform}/{browser}/`). Baselines for Windows and Chromium are committed. Create or refresh a set with `npm run test:visual -- --update-snapshots`; on another platform, generate a set before relying on it. The tolerance is 20 pixels: a one-token change of control radius fails every affected image.

## What this does not verify

- It compares appearance against this project's own earlier appearance, not against native macOS. The native reference (screenshots from a Mac) is a separate step.
- Static screenshots cannot show motion. Motion is checked by behaviour (does the thumb move, reverse, and stop under reduced motion), not by frame comparison.
- Reduced transparency can only be emulated in Chromium. Firefox and WebKit are checked for behaviour, not for that fallback.
