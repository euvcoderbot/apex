# UI refinement — 21 October 2026

Addresses the race menu, lap typography, circuit inspector, performance toolbar,
and multi-race selector reported in the visual review.

- Bounded race pop-up with scrolling, a selection check, smaller flags, and wrapped names.
- Browser-owned zoom and responsive breakpoints replace compounded page/sidebar scaling.
- Apple system typography on Apple devices; Inter fallback elsewhere. Canvas labels use
  the same family as the interface. Lap times use tabular lining numerals, a quieter
  weight, and consistent size. Corner labels no longer have heavy text outlines.
- Refresh moves into the performance heading beside the filters, with a compact
  accessible icon on phones. The existing delegated refresh handler is retained.
- Race selection is a bounded list/grid with highlighted, outlined selected rows
  and fixed flag/round columns; there are no additional track checkboxes.
  Legacy grid placement is reset so tablet selection uses the available width.
- Corner selection uses small outlined choices with explicit selected states and
  larger targets for coarse pointers. Map title, metadata, and legend are separated.
- Analyse remains disabled when track scope has no selected races.

No changes to measurement algorithms, eligibility, ranking, or source data.

Validation: 251 existing tests passed before the final layout-only refinements;
the release workflow reruns the complete suite and production build. Loaded Singapore
qualifying laps (VER/LEC), corner selection, menu keyboard behavior, and performance
views were checked at desktop, tablet, and phone widths with no page overflow.

The existing Figma file is https://www.figma.com/design/32fieprdLFtiUcUSq0yU6z.
Its Starter MCP quota prevented syncing this follow-up revision to the canvas;
the deployed site and this source are the current implementation.

References: https://developer.apple.com/design/human-interface-guidelines/typography,
https://developer.apple.com/design/human-interface-guidelines/toolbars,
https://developer.apple.com/fonts/.
