# Apex (F1 Apex Data): instructions for coding agents

## UI work: read the design docs first

The site has one look, Linear's. Before adding or changing anything visible, read:

0. `docs/linear-design-spec.md`: the specification, measured in Linear's app. It wins where documents disagree.
1. `docs/linear-design.md`: everything Linear has published about its design, its full token set (`design/linear-tokens.json`) and measurements of linear.app.
2. `docs/linear-components.md`: recipes for cards, tiles, charts, buttons, tables, chips, and the checklist.
3. `docs/linear-look.md`: Linear's published colours, type ramp, radii and motion, with sources.
4. `docs/linear-workspace-spec.md`: the frame and layout (rail, header, content, inspector).

Follow the recipes and the checklist in `docs/linear-components.md`; check dark, light and 390 px width; run `npm run test:visual`.

## The Linear design system: mandatory rules

- `docs/linear-design-spec.md` is the specification (values measured in the signed-in Linear app win over every other document).
- `skins.css` is the one authority for the look: one token block, then frame, rail, header and primitives. Change the rule that
  owns a look; never add a cascade layer, a version section ("v6"), a second token block or `[data-skin][data-skin]` weight.
- Weights 450/500/600 only; sentence case (no `text-transform: uppercase`); no decorative gradients or glows; one card level.
- Verify visible changes by screenshot (dark, light, 1440 and 390 px) and run `node scripts/audit-linear.mjs --quick`;
  `scripts/test-linear-system.mjs` enforces the rules above in `npm test`.
