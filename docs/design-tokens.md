# Design tokens

`tokens.css` is the one owner of every shared design decision. It is the first real cascade layer (`tokens`, below `legacy`
and every component layer in `lib/ui-style-build.mjs`), so a component can read a token but can never redefine it.

## Rules

1. **Everything declared on `:root` lives in `tokens.css`**, light and dark: dark is the default, light is
   `:root[data-theme="light"]`, conditional values (touch input, narrow screens) sit in their `@media` block beside it.
2. **Component-scoped custom properties stay with the component** (a team colour on a card, a thumb offset on a control).
   A token is something more than one component shares.
3. **A token is declared once.** `node scripts/audit-tokens.mjs` reports any custom property declared on `:root` in more
   than one file and which declarations are shadowed (a later cascade layer always wins, so they never applied);
   `--write` removes them. It currently reports 0.
4. **Changing a value is deliberate.** `e2e/tokens.spec.mjs` records the computed value of every `:root` custom property in
   both appearances (`e2e/__tokens__/tokens.json`) and fails when one changes. After an intended change run
   `UPDATE_TOKENS=1 npm run test:e2e -- tokens` and review the diff of that file. Moving a token between files must leave it
   untouched.

## What is in it

Reference scales, then roles built on them:

| Tier | Tokens |
|---|---|
| Radius scale | `--radius-2xs` 2, `-xs` 4, `-sm` 6, `-md` 8, `-lg` 12, `-xl` 16 px, `-pill`. Concentric: a card (xl) holds controls (md); a menu (lg) holds rows (sm); a segmented track (md) holds a thumb (sm) inset 2 px. |
| Motion scale | `--motion-tier-fast` 150 ms (hover, press, selection), `-standard` 220 ms (something moves or opens), `-slow` 320 ms (sheet, bar, view); `--ease-standard`, `--ease-out`, `--ease-in`, `--ease-spring`. Apple publishes no numeric motion values; these are perceptual tunings. |
| Type ramp | `--type-caption` 12, `-callout` 13, `-body` 14, `-headline` 15, `-title3` 17, `-title2` 22, `-title1` 28 px |
| UI roles | `--ui-label`, `--ui-canvas`, `--ui-panel`, `--ui-accent`, `--ui-control-height`, `--ui-sidebar-width` and the rest of the `--ui-*` set |
| Controls | `--hig-regular`, `--hig-small`, `--hig-radius*`, `--hig-fast`, `--hig-medium` (now aliases of the scales above) |
| Materials | `--mat-bar`, `--mat-menu`, `--mat-blur-menu`, `--mat-edge`, ... |

The old colour, radius, shadow and font names (`--bg-card`, `--text-main`, `--accent`, `--font-sans` and 23 others) were
rewritten to their `--ui-*` roles and deleted. What still carries its own value from the first design: the `--glass-*` set,
`--scroll-thumb*`, `--shadow-main`, `--shadow-inset`, and the `--material-*` set in `workspace-ui.css` (blue-tinted, to be
checked for use and then folded into materials or removed).

## Decisions still open

- **Type sizes.** 147 literal px sizes were tied to the ramp at the same size. The `rem` sizes were not: the root font size is
  18 px, so `.875rem` is 15.75 px and `.75rem` is 13.5 px, a second set of sizes that a ramp change would move visibly.
  The 77 declarations below 10 px sit in `design-system.css` and `polish.css`, the two oldest sheets, and are probably overridden.
- **Motion beyond the scale.** Interruptible animation, anchoring popovers to their trigger and interactive glass are the next
  motion work. Spinner durations (0.7 to 1.2 s) and a few stagger delays stay literal.

## Visual pass (2026-10-31)

The last section of `hig-system.css` holds the deliberate look of the app, on top of the tokens:

- Sidebar driver and race lists are flat rows. A chosen row is `--ui-selection-tint` (the accent at 18%) with an accent check, so team marks and text stay readable on it; it strengthens under increased contrast and gains an outline in forced colours.
- One filled action per area. *Fastest* and *Compare fastest* are tinted until they are the thing being acted on.
- Sections sit on the window background; only the cards inside them have a surface.
- Toolbar options are icons with tooltips and accessible names.
- Corner cards show a full-width rail under each row instead of a 36 px bar between name and value.
- The Car performance status strip takes no space: nothing at rest, a floating pill while loading.
- Pit stops gives its table two thirds of the width, and stacks below 1400 px, so no column is lost to a hidden scroll.

`e2e/integration.spec.mjs` and `e2e/session-view.spec.mjs` check the parts of this that can regress silently: tab labels and table columns are not cut off, no blank band above the tabs, text contrast on chosen rows and on Compare fastest in both appearances, and named toolbar icons.
