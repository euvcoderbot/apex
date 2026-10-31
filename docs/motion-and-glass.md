# Motion and Liquid Glass

What the interface does when you touch it, where each piece is defined, and what is documented by Apple versus tuned by eye.

## Sources

Apple's guidance on both is qualitative. It publishes no blur radii, opacities, durations or spring constants for macOS 26 or 27.

- [HIG: Materials](https://developer.apple.com/design/human-interface-guidelines/materials): Liquid Glass belongs to the navigation layer and to transient controls, never to content; no glass on glass; the one number is the 35% dimming layer for *clear* glass over bright media.
- [HIG: Motion](https://developer.apple.com/design/human-interface-guidelines/motion): purposeful, brief feedback tied to the action; never make people wait for an animation; avoid motion on frequently used controls.
- WWDC26 session 289, *Modernize your AppKit app*: the macOS 27 "interactive glass effect": the glass subtly bounces when clicked. "A little goes a long way." No parameters are given.
- WWDC25 session 219, *Meet Liquid Glass*: regular versus clear, scroll edge effects, tint only the primary action.

Everything numeric below is an engineering approximation and is labelled as one in the CSS.

## What is implemented

| Piece | Where | Behaviour |
|---|---|---|
| Material layers | `tokens.css` `--mat-*`, applied in `hig-system.css` | Toolbar and sticky table headers (navigation layer); menus, popovers, tooltips, toasts, sheets (transient layer). Cards, charts and tables stay opaque. |
| Scroll-edge effect | `hig-system.css` | The toolbar hairline appears only once content scrolls beneath it. |
| Interactive glass | `glass.js`, `hig-system.css`, `--mat-glint`, `--glass-press-scale` | Toolbar controls (the view switch and the icon buttons) show a faint highlight under the pointer and a 3% springy scale on press. Pointer devices only. |
| Popover | `hig-system.css` | Fade plus a 3% scale from its top-left corner, reversed on close. |
| Sheet | `hig-system.css` | Fades and drops 12 px, scrim fades, reversed on close. |
| Menus | `hig-system.css` | Plain fade, as AppKit's. |
| Chrome is not text | `hig-system.css` | Buttons, tabs, segmented controls, menus and the toolbar cannot be text-selected; tables, values, fields and explanations can. |

Durations and curves come from the motion scale in `tokens.css` (`--motion-tier-*`, `--ease-*`).

## Accessibility

- Reduced motion removes the press scale and every transition (a single rule at the end of `hig-system.css`).
- Reduced transparency and increased contrast remove the highlight and replace the translucent fills with opaque ones.
- No hover highlight on touch, and `glass.js` does nothing for touch pointers.
- Reduced transparency can only be emulated in Chromium; the other engines are tested for behaviour.

## Browser limits

- Real refraction (lensing) needs an SVG displacement filter in `backdrop-filter`, which only Chromium supports. It is deliberately not used: it would be Chromium-only and would sit over content.
- A page cannot read macOS 27's transparency slider, only the reduced-transparency and increased-contrast media queries.
- The highlight is a radial gradient, not a sampled reflection of what is behind the control.

## Tests

`e2e/glass.spec.mjs` (Chromium, Firefox, WebKit): chrome is not selectable and content is; the highlight follows the pointer and lets go; the press scale springs back and is removed under reduced motion; reduced transparency and increased contrast remove the highlight; the sheet fades in, its scrim fades, both reverse; the popover scales from its control. `e2e/shell.spec.mjs` checks the real page's toolbar controls are marked and respond.
