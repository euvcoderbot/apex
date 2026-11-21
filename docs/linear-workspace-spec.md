> Historical research: numerical values in this document describe the earlier public-site study. For implementation, use docs/linear-design-spec.md and docs/linear-components.md. The signed-in app was measured on 2026-11-10; its 244 px rail, 450/500/600 weights and measured surfaces supersede the provisional values below.

# Linear workspace redesign

Research: 2026-11-05. This is an Apex adaptation, not an assertion that we have
Linear's private component library. The public product demo can be measured;
published essays explain intent; product documentation explains behavior.

## Evidence and decisions

| Source | Relevant guidance | Apex implementation |
| --- | --- | --- |
| [2026 refresh](https://linear.app/now/behind-the-latest-design-refresh) | Distinct location and view bars; navigation recedes; predictable action placement; quieter icons and separators. | Persistent navigation rail, location header, horizontal session/scope filter bar. Chart content gets the broadest surface. |
| [2024 UI redesign](https://linear.app/now/how-we-redesigned-the-linear-ui) | Cohesive sidebar/header/panels, type hierarchy, theme foundations, feature-flag comparison. | Existing look toggle retained; Inter, shared surface/text tokens, light/dark coverage. |
| [Display options](https://linear.app/docs/display-options) | View-specific display controls at the upper right; personal preferences persist. | Appearance/explanation controls stay in the location bar; compact/comfortable density is browser-local, not a data filter. |
| [Filters](https://linear.app/docs/filters) | Contextual criteria and visible filter state. | Existing season/event/session and performance scope controls become a distinct view bar. Existing URL state remains authoritative. |
| [Search](https://linear.app/docs/search) | Search is contextual and keyboard accessible. | Searchable command dialog navigates actual Apex views and focuses existing filters, without fake results or network calls. |
| [Selection](https://linear.app/docs/select-issues) | Highlight and committed selection are different states. | Hover uses a faint neutral wash, selected navigation a stronger neutral fill, selected lap choices an accent tint, keyboard focus an outline. |
| [Insights](https://linear.app/docs/insights) | Chart and table are complementary; configuration and drill-down are contextual. | Ranked bars use consistent flat, square-ish geometry, aligned values and quiet separators. Scientific time-series remain traces; accessible data remains available. |
| [Method](https://linear.app/method/introduction) | Purpose-built workflows, reduced busywork. | Reuse real analysis actions; no issue-tracker metaphors, decorative controls or invented analytics. |
| [Brand](https://linear.app/brand) | Restrained neutral foundation and identifiable accent. | Retain Apex branding and team identity colors. Do not use Linear's logo. |
| [Public demo](https://linear.app/homepage) | Measured navigation rows ~28px, Inter 13px/510, 8px menus, neutral selection. | Shared rhythm: 28px controls, 28px rail rows, 6px control corners, 8px menus. |

## v3: measured from Linear's own app frame (2026-11-05)

Linear's homepage renders its real app chrome. Measured there, and in its token sheet:

| Element | Linear | Apex (Linear look) |
| --- | --- | --- |
| Frame | canvas `#090a0b`, 12 px outer radius, 8 px padding; the view is a separate panel: 8 px radius, 1 px white 5% border, a 2 px `#0003` outer ring | rail on the canvas; header, view bar and content share one view inset 8 px, 10 px corners, hairline and ring. A fixed mask outside the rounded edge keeps scrolled content inside. |
| Sidebar | 232 px; workspace row with a 28 px round search button | 264 px (driver rows need the width); same row and round search button (Ctrl K) |
| Nav rows | 28 px, 8 px radius, padding 0 7, gap 8, 13 px/510 secondary text, icons quaternary, 2 px between rows; active white 4%, hover white 2% | same values |
| Section headings | 24 px, 12 px/510, quaternary, caret, fold their section | same; Analysis, Measurements, Drivers fold |
| View header | 44 px, hairline bottom border, breadcrumb left, actions right | same; icon actions 28 px |
| Labels | 24 px pills, hairline border, 12 px, coloured dot | filter chips (`Season 2026 ⌄`), track choices, comparison laps with the lap colour as the dot and a "Ref" tag like Linear's model tag |
| Cards | `#161718`, 6 px radius, white 6% border | widgets: white 2% fill, white 6% hairline, 8 px corners, 13 px/590 titles |
| Dialogs, menus | 12 px dialog radius, shadow-high `0 7px 32px #00000059`; menus 8 px with 28 px rows | lap sheet and command menu at 12 px with shadow-high; menus 8 px with 28 px rows |
| Type | text-mini 13/1.5 −.01em, micro 12/1.4, title-2 20 px/1.33 −.012em | same |
| Motion | highlight fade-in 0 s, fade-out .15 s; quick .1 s; ease-out-quad | same |

From Linear's design essays: the 2024 redesign (inverted-L chrome; three theme inputs in LCH; Inter Display for headings),
the 2026 refresh (navigation a few notches dimmer than content; compact rounded tabs; fewer, smaller icons; fewer, softer separators;
a slightly warmer grey), "A Linear spin on Liquid Glass" (the ProKit stance: depth without refraction, clarity for dense work,
solid outlines under increased contrast), "Best practices for designing Linear Dashboards" (purpose-built, glanceable widgets; context beside
each number), and "Invisible details" (contextual menus that teach shortcuts).

Applied to Apex:
- Drivers are listed one per row in the rail (Linear's favourites pattern); on phones they stay in the lap sheet, still one per row.
- Ranked bars share one thickness (8 px) in every Car performance category. Rows have no separators;
  the hover is a rounded wash that bleeds 8 px past the text, so nothing clips it.
- Under `prefers-contrast: more` every hairline becomes the strong border.

## Foundations

Exact measured color tokens and contrast adjustments are in `generate-skin.mjs`
and `linear-look.md`. Dark surfaces progress from #08090a through #0f1011 to
#1c1c1f; light uses a warm gray frame and white content. Four text levels separate
task content from navigation and metadata. Team colors denote identity, never
selection. Inter Variable uses optical sizing, `cv01` and `ss03`; numerical values
are tabular. Font weights 510 and 590 establish interface hierarchy.

Motion values measured from public CSS: immediate hover-in / 150ms hover-out,
100ms menu, 120ms tooltip, 175ms dialog, ease-out-quad. Frequent navigation has no
entrance delay. Reduced motion removes spatial animation. These values are a
public implementation observation, not a promise about every Linear screen.

## Interaction and layout contract

- The Linear mode has a workspace rail, location header, view filters, content,
  and optional track inspector. Mobile uses a horizontal navigation strip and
  wrapped filters, not a squeezed desktop sidebar.
- Existing navigation/category nodes are moved, not cloned. Their handlers,
  accessible names, URL behavior and data state survive look changes. Comment
  anchors restore exact original positions when returning to macOS.
- Command search supports Ctrl/Cmd K, arrows, Enter and Escape; native dialog
  provides focus containment. Closing restores the invoking control.
- Ranked bars have no artificial minimum width. Values rounding to displayed
  zero draw no colored sliver; raw values and exact tooltip data are preserved.
- No download, computation, data revision relabeling or release-policy relaxation
  is part of the redesign.

## Verification

Test both themes, navigation, command keyboard flow, responsive overflow and existing session comparisons. Verify
source checks and typechecks. Publication still requires full strict release
checks against honestly compatible prepared data; source-only CI is not enough.
