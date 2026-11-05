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
- Density only changes presentation, never eligibility, calculations or values.
- Ranked bars have no artificial minimum width. Values rounding to displayed
  zero draw no colored sliver; raw values and exact tooltip data are preserved.
- No download, computation, data revision relabeling or release-policy relaxation
  is part of the redesign.

## Verification

Test both looks, themes, navigation, command keyboard flow, density persistence,
node restoration, responsive overflow and existing session comparisons. Verify
source checks and typechecks. Publication still requires full strict release
checks against honestly compatible prepared data; source-only CI is not enough.
