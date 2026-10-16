# macOS dark redesign — complete element inventory (v123–125)

This release replaces the Windows/Fluent appearance with a macOS-inspired web interface across Session analysis and Car performance. Dark is the default; an existing explicit Light preference still works. This is a browser adaptation, not a claim to implement native AppKit, desktop wallpaper tinting, system Liquid Glass refraction, or an Apple certification.

## Apple guidance used

Reviewed the current official guidance on 16 October 2026:

- [Materials](https://developer.apple.com/design/human-interface-guidelines/materials): reserve glass primarily for navigation and transient controls; keep content readable.
- [Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode): neutral layered surfaces, semantic text levels and sufficient contrast.
- [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons): clear primary actions, consistent sizing, visible press and disabled states.
- [Segmented controls](https://developer.apple.com/design/human-interface-guidelines/segmented-controls): related exclusive choices, clear selected segment and short labels.
- [Pop-up buttons](https://developer.apple.com/design/human-interface-guidelines/pop-up-buttons): labelled compact choices and selected-item indication.
- [Scroll views](https://developer.apple.com/design/human-interface-guidelines/scroll-views): native scrolling, unobtrusive indicators and no unnecessary nested scrolling.
- [Motion](https://developer.apple.com/design/human-interface-guidelines/motion): brief purposeful feedback, no gratuitous motion, Reduce Motion support.
- [Layout](https://developer.apple.com/design/human-interface-guidelines/layout), [Typography](https://developer.apple.com/design/human-interface-guidelines/typography), [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars), [Toggles](https://developer.apple.com/design/human-interface-guidelines/toggles), [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility).

## Every shared element redesigned

| Element family | Implemented change |
| --- | --- |
| 1. App canvas | Neutral near-black canvas; removed the blue/purple Windows tint. |
| 2. Surface hierarchy | Distinct canvas, content, inset and selected surfaces; softer separators and restrained shadows. |
| 3. Typography | Apple system-font-first stack, normal/medium/semibold hierarchy, tabular timing values; platform fallback on Windows. No bundled proprietary fonts. |
| 4. Header | Translucent blurred navigation layer with subtle separating edge. |
| 5. Session / Car selector | Fixed-footprint capsule, raised selected segment, no Windows underline, no width changes on click. |
| 6. Display actions | Quiet rounded explanation, theme and sidebar actions outside the main mode selector. |
| 7. Category sidebar | Glass navigation container; rounded selected row and restrained monochrome/accent icons. |
| 8. Cards and panels | Consistent corner radii and stable opaque reading surfaces; no glass under numerical content. |
| 9. Form labels | Secondary text, consistent spacing, baseline and control heights. |
| 10. Selection boxes | Rounded neutral pop-up-style triggers with comfortable line height, no clipped flag/text rows. |
| 11. Dropdown menus | Blurred raised menu, selected checkmark, blue focused row and clear disabled state. |
| 12. Dropdown keyboard interaction | Arrow/Home/End/Escape handling retained; added type-to-find and repeated-key cycling; disabled items skipped; closed options removed from Tab order. |
| 13. Primary buttons | Blue capsule Load actions; matching sizes; subtle hover, press and disabled feedback. |
| 14. Secondary buttons | Neutral rounded refresh, cancel, track and explanation actions. |
| 15. Exclusive segmented choices | Unified Teams/Drivers, Qualifying/Race, bands, units, mean/median and metric selectors. Controls wrap rather than force pointless scrollbars. |
| 16. Multi-select pills | Track and corner choices use consistent tinted selection, visible outline/marker and rounded hit regions. Multi-select is not misrepresented as one exclusive segment. |
| 17. Driver list | Rounded list rows and selected treatment; retained team identity and visible selection mark. |
| 18. Tyre cards | Compact grouped inset cells; non-growing sidebar cards still cannot overlap the driver list. |
| 19. Run/stint selectors | Consistent rounded grouped tiles, clear active run, wrap within available width. |
| 20. Lap selection | Compact rounded lap tiles, visible selection and disabled states; fastest action uses the same control language. |
| 21. Loaded comparison pills | Capsule comparison references, round remove action and clear reference treatment. |
| 22. Lap summary | Compact two-line identity/tyre header; lap time beside it; inline sector values/deltas and a single wrapping weather strip. No values removed. |
| 23. Sector indicators | Thin status accent, aligned timing values and signed delta badges, less empty padding. |
| 24. Map and corner panels | Quiet inset reading surfaces; capsule guide/comparison selector and rounded multi-corner buttons. Geometry and measured zones unchanged. |
| 25. Chart containers | Consistent inset plotting panels, headings and quieter borders. Trace axes and comparison distance domain unchanged. |
| 26. Trace controls | Rounded visibility chips, visible checkbox focus and a glass floating zoom group. |
| 27. Tooltips and toasts | Raised neutral material, readable text, unified radius and shadow. |
| 28. Comparison bars | Rounded tracks and fills; existing compact chart/table arrangement retained; readable wrapping labels. |
| 29. Tables | Quiet non-uppercase headings, subtle alternating/hover rows, compact short tables that fit their container, numeric alignment retained. Wide evidence tables may still scroll when necessary. |
| 30. Status badges | Consistent capsule coverage, traffic, retirement and track-count badges; status meaning and text retained. |
| 31. Disclosures | Quiet rounded Show explanations/evidence controls with clear focus and hover. |
| 32. Text, number and search inputs | Shared neutral inset field, border and accent focus treatment. Native selects remain platform-rendered where used. |
| 33. Checkboxes, radios, sliders and progress | Shared accent; visible focus/state; native semantics retained. No fictitious progress percentages added. |
| 34. Scrollbars | Thin rounded neutral thumbs and transparent track. Actual overlay/autohide behavior remains browser/OS controlled. |
| 35. Loading, empty and error states | Consistent quiet status line and empty-state text, rounded error surface with semantic warning tint. |
| 36. Animation | Short hover/press/menu transitions, no automatic panel entrance animation; removed the obsolete global pointer-following glint handler and its layout reads. |
| 37. Accessibility | Focus-visible ring; non-color selection indicators; reduced motion, reduced transparency, increased contrast and forced-color fallbacks; larger coarse-pointer controls. |
| 38. Responsive behavior | Compact desktop sidebar, two-column category navigation on small screens, wrapping controls and single-column data views when space is limited. |
| 39. Light appearance | Matching neutral light tokens retained so the existing theme action remains usable. |
| 40. Stylesheet delivery | New macos-ui.css in the document head; removed fluent-ui.css from source and build delivery; visual revisions refresh browser assets without invalidating raw telemetry. |

## Category-by-category coverage

| Section | Changes visible in this release |
| --- | --- |
| Session selection | Season, event and session pop-ups, keyboard navigation, primary load action and labels. |
| Drivers and results | List rows, driver selection, Points/Gap segmented control, stable tyre card. |
| Lap workspace | Runs, stints, fastest-lap action, lap tiles and loaded-lap reference pills. |
| Lap telemetry | Compact identity/tyres/sectors/weather summary, chart surfaces and headings. |
| Corner performance | Corner/straight pills, detail table, guide/comparison segmented control, map container. |
| All telemetry channels | Speed, delta, throttle, brake, gear and DRS share the same chart/control/tooltip treatment. |
| Car event selection | Season/scope, track selection tray, event pills, load/cancel/refresh states. |
| Pace | Shared category navigation, cards, compact charts, tables, status and evidence disclosures. |
| Qualifying and Race cornering | Unified session/subject/band controls, measured-result bars, sample/evidence tables and status lines. |
| Straight line | Top-speed/settled-speed/acceleration cards, band selectors, bars, tables and support badges. |
| Braking | The existing two metrics get the same segmented controls, bar/table treatment and evidence disclosures; no new method choices. |
| Pit stops | Matched compact selectors, controls, bar charts, table rows and diagnostic states. |
| Tyre trend | Compound controls, individual-run selectors, plot container and per-lap disclosure. |
| Development & updates | Compact progress table, neutral inset sparklines, clearer status badges and signed change. |
| Reliability & results | Summary and evidence tables, rounded retirement badges and shared result/status presentation. |

## Scope and verification

This is a presentation/interaction release. It does not alter source lap eligibility, measured performance, sample counts, point rules, or ranking equations. It does not implement the separately requested local-processing service or fix Sprint/Sprint Qualifying source loading. Those remain separate data/backend work, not theme changes.

Automated checks cover CSS parsing, all element families, delivery order, removal of Windows styling, accessibility fallbacks, summary field retention, dropdown keyboard behavior and the existing calculation regressions. Visual verification and deployment results are recorded in the release handoff; do not equate passing CSS tests with a full visual inspection of every live category.

The live release was checked with Singapore 2026 selected: qualifying session, two comparison laps, run/lap controls, summary, tyres and telemetry; all eight Car categories were navigated at a 1440-pixel desktop breakpoint and a 390-pixel phone breakpoint. No page-level horizontal overflow was observed in any category at either size. This is a representative layout check, not proof that every historical event and every optional evidence table has been visually inspected. The live check found and corrected an inherited full-width weather-item rule, a higher-specificity primary-button shape, and the phone load-action width in v124. All 195 JS tests passed before the final CSS refinement; focused UI checks and the production build are repeated for that refinement.

The final v125 alignment refinement reserves the same delta-row height for reference and comparison sectors, so their sector indicators and weather rows line up even though the reference has no delta badge.
