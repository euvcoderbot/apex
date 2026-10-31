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

## What is in it (155 tokens)

| Family | Count | Examples |
|---|---|---|
| UI roles | 71 | `--ui-label`, `--ui-canvas`, `--ui-panel`, `--ui-accent`, `--ui-control-height`, `--ui-sidebar-width` |
| Control sizes, radii, state fills, motion | 17 | `--hig-regular`, `--hig-radius`, `--hig-fast` |
| Type ramp | 7 | `--type-caption` … `--type-title1` |
| Materials | 8 | `--mat-bar`, `--mat-menu`, `--mat-blur-menu`, `--mat-edge` |
| Legacy aliases | 35 + 17 | `--bg-card`, `--text-main`, `--accent`, `--border-color`, `--glass-fill`, `--shadow-main`, `--radius-card` |

The legacy aliases are the names the older stylesheets (`design-system`, `apple-ui`, `workspace-ui`, `macos-ui`) read. Each
resolves to a `--ui-*` role, so there is one value behind every name; the next step is to migrate those stylesheets to the
role names and delete the aliases.

## Decisions this does not make

Collapsing duplicates changes no pixel. Choosing *values* does, and is a design decision with its own milestone:

- **Radii.** The stylesheets use 14 literal corner radii (2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14 px, 999 px, 50%). Native macOS
  uses contextual, concentric geometry, so the target is a short scale plus container-derived inner radii, not one number.
- **Type sizes.** 12+ literal sizes, including values below 10 px that need inspection.
- **Motion.** 16 durations and 9 curves; milestone 3.
- **Materials.** Defined once here (`--mat-*`); their placement and interactive behaviour belong to milestone 4.
