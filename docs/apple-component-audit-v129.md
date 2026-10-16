# Apple HIG component audit — v129

## Scope and accuracy

The target is a coherent **macOS dark-mode web adaptation**, not a mixture of Windows, iOS and macOS patterns. Apple's HIG describes semantic roles and platform behaviour; it is not a single pixel specification for arbitrary web dashboards. This release does not claim Apple certification or native AppKit rendering.

Every button, form field and disclosure in the rendered app receives an explicit component family. The UI catalogue at `/apex/ui-catalog.html` uses the production stylesheet and decorator to expose states without any telemetry requests. The ownership audit reports unassigned controls; **zero unassigned controls is not, by itself, proof of conformance to every HIG recommendation**.

## Architectural correction

Previous releases loaded several unlayered appearance sheets on top of older rules. High-specificity selectors and visual `!important` declarations could override the newer design. The build now emits **one CSS response**, with explicit layers:

`focus → legacy → interface → workspace → appearance → components`

`ui-controls.css` is the final normal appearance owner. The compiler demotes old visual `!important` declarations, but retains forced-colour safeguards, hidden-state rules and important layout/canvas sizing. Focused-chart height rules are hoisted to the first layer so zoomed charts continue to fill their viewport. Old layout support remains isolated; it no longer chooses the final button colours or typography.

## Complete component-family review

| Family | Applied rule and implementation |
| --- | --- |
| Typography | One system-font stack, consistent 13px body/12px control/data text, tabular numerals, restrained semibold headings; no decorative monospace or uppercase control labels. |
| Semantic colours | Separate label, secondary, tertiary, canvas, panel, well, control, selection, accent, positive, negative and warning tokens, with independent light/dark values. Core label/background and primary-action contrast are tested. |
| Content surfaces | Quiet solid content surfaces, thin boundaries and concentric radii; no floating shadow on every card. |
| Navigation material | Translucency is limited to the top navigation and transient menus/tooltips; opaque fallbacks exist for reduced transparency and increased contrast. |
| Primary push buttons | One prominent action per setup area; shared blue fill, regular size and stable press/disabled/loading treatment. |
| Secondary push buttons | Shared neutral fill, fine bezel, restrained top highlight and no scale/bounce on press. |
| Toolbar buttons | Borderless by default, standard hover background, meaningful tooltip and explicit toggled appearance. |
| Image/close buttons | Shared vector symbols, matching stroke weight and hit regions; no platform-dependent emoji or typographic arrow in zoom/remove controls. |
| Segmented choices | Equal sizing for related options, a shared enclosing control and an obvious selected segment. Left/Right/Home/End navigate enabled choices. No unsupported radio semantics on toggle-button groups. |
| Main-area tabs | Content remains enclosed and controls stay within the pane they affect. Selection and keyboard interaction are retained for Traces/Corners and car categories. |
| Pop-up buttons | Current value remains visible, labelled control, consistent paired chevrons, anchored menu, checked selected item, disabled choices, keyboard/typeahead/Escape behaviour. Dynamic tyre selectors use the same pop-up implementation as session selectors. |
| Long option sets | Eight acceleration ranges are now one labelled pop-up instead of an overcrowded segmented row. Unsupported ranges remain disabled; the calculation and selected range are unchanged. |
| Race chooser | A visibly bordered expansion control, not an unstyled piece of heading text; its multi-selection grid opens inside the setup group. |
| Menu items | Shared 28px regular rows, subtle rounding, selection checkmark, accent hover/focus and honest disabled states. |
| Search/text/number fields | Shared inset field, legible placeholder, focus ring, read-only and invalid-state treatments. |
| Checkboxes | Square macOS-style controls with off/on/mixed/disabled/focus states. Existing trace checkboxes are not replaced by iOS switches. |
| Radio buttons | Circular mutually-exclusive controls, demonstrated in the catalogue; not substituted for multi-selection. |
| Colour wells | One small square well; no decorative pencil button inside another pill. The browser owns the actual colour-picker window. |
| Driver/source lists | Quiet rows, full-row selection, consistent identity/secondary text, hover/focus states and persistent selection indication. Team identity uses logos/colour marks, not an entire team-tinted button. |
| Run/phase controls | Shared segmented-family sizing and state; preserved compound/run information. |
| Lap/track/corner choices | Consistent choice tiles, clear add/check/selected states, focus treatment and no colour-only selection indication. |
| Loaded comparisons | Shared reference/chip container, clear reference state and vector remove action. Lap names remain legible instead of relying on potentially dark team-coloured text. |
| Data badges | Small rounded rectangles with consistent font/padding; warning/negative/positive variants retain semantics without oversized red capsules. |
| Disclosures | Descriptive label and leading disclosure indicator; expanded/collapsed state is preserved. Hidden controls are removed from interaction. |
| Tables | Quiet header/row separators, restrained alternating rows, aligned numeric columns and shared label sizes. Sort controls remain part of headers, not independent raised buttons. Columns can be resized by dragging their header edge or using the focused separator's arrow keys. Double-click/Home restores the default width; sizes survive data redraws during the visit. |
| Sort direction | Small consistent vector chevrons; active direction remains visible, unsorted symbols do not clutter every header. |
| Chart presentation | Shared chart surface, heading, subtitle, legend and coverage styles; source colours continue to encode data, not generic control state. |
| Zoom/step controls | Connected, evenly sized toolbar controls with vector plus/minus/direction symbols and explicit disabled bounds. |
| Full chart view | The same controls are used in expanded mode; important canvas sizing and Escape/close recovery are preserved. |
| Tooltips/popovers | Legible text, restrained material/border/shadow and consistent radii; no content-card glass proliferation. |
| Loading/progress | Shared activity indicator and thin progress track; loading is distinct from disabled/unavailable data. |
| Empty states | Quiet vector illustration and short title/action context, replacing decorative racing-car/graph emoji. |
| Errors and limitations | Compact readable feedback; missing data, estimates, coverage and retry actions remain visible. No numerical value is fabricated to make the interface look complete. |
| Scrollbars | Thin, transparent tracks, consistent rounded thumb and no forced always-visible horizontal track. Native scrollbar interaction remains browser-controlled. |
| Motion | Short state transitions; no blanket button scaling. Reduced-motion rules remain mandatory. |
| Pointer and touch | Regular macOS control sizing, minimum-sized icon/colour-well controls and larger 44px touch targets on coarse pointers. |
| High contrast/forced colours | Opaque materials and stronger boundaries when requested; visible focus and native system-colour overrides are retained. |

## States checked by the system

Default, hover, pressed, selected, keyboard focus, disabled, loading, empty, progress, error, invalid field, read-only field and mixed checkbox. States are applied where semantically relevant, not invented for every component.

## Intentional web/platform limits

Long result-measure labels use a pop-up instead of a crowded four-segment row. On narrow screens, display tools form a separate aligned row, race-picker arrows stay on the same line, and short segmented labels can wrap without overlapping neighbours.

- **Liquid Glass optics:** CSS can approximate blur, saturation, edge highlights and hierarchy. It cannot use AppKit's behind-window sampling, refraction or system-managed vibrancy.
- **Fonts:** macOS uses its installed system font. Windows uses the declared available fallback; this release does not redistribute Apple's restricted system fonts.
- **System picker windows, browser chrome and scroll behaviour:** these are controlled by the user's browser/OS, not the page.
- **SF Symbols:** the web uses consistent, ordinary inline vector icons for familiar actions; it does not pretend that generic SVGs are system-provided SF Symbols.
- **F1 charts, track maps and telemetry tables:** these are domain-specific views without a stock native Apple equivalent. They follow the same hierarchy, spacing, type, contrast and interaction rules.
- **Eight car categories:** all eight remain visible as compact wrapping category navigation because rapid cross-category comparison is central to this dashboard. They are not squeezed into one segmented picker. A compact two-column layout is used on narrow screens.

## Sources used

- [Apple HIG: Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)
- [Materials](https://developer.apple.com/design/human-interface-guidelines/materials)
- [Toggles](https://developer.apple.com/design/human-interface-guidelines/toggles)
- [Pop-up buttons](https://developer.apple.com/design/human-interface-guidelines/pop-up-buttons)
- [Segmented controls](https://developer.apple.com/design/human-interface-guidelines/segmented-controls)
- [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars)
- [Disclosure controls](https://developer.apple.com/design/human-interface-guidelines/disclosure-controls)
- [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
- [Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables)

Source, eligibility and numerical ranking methods were not changed by this component-system release.

## Verification

- 208 JavaScript checks pass, including CSS-bundle ownership, retained focus-mode sizing, contrast of core labels/action text, control states and preservation of useful data choices.
- Browser checks covered all eight car-performance categories at 1280, 1024, 768 and about 390 CSS pixels. There was no page-level horizontal overflow or unclassified interactive control in those 32 configurations. Wide evidence tables retain their own scroll container; this is not a claim that every possible dataset was visually inspected.
- Verified acceleration range changes and tyre-team changes retain focus on the rebuilt pop-up, and the tyre inspector remains open.
- Verified table resize with arrow keys, restoration with Home, and width retention after sorting.
- Verified two-lap qualifying comparison loading, automatic selector collapse, focused-chart expansion/return and non-zero map canvas size.
- The catalogue demonstrates dark/light, selected, disabled, mixed, loading, error and disclosure states using the production component stylesheet.

These checks establish component coverage and exercised behaviour, not native AppKit equivalence or a certification of full accessibility compliance.
