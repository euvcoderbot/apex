# macOS-inspired web interface preview

Local-only redesign. Do not publish without review and approval.

Reviewed Apple Human Interface Guidelines on 2026-09-07:
- https://developer.apple.com/design/human-interface-guidelines/designing-for-macos/
- https://developer.apple.com/design/human-interface-guidelines/lists-and-tables
- https://developer.apple.com/design/human-interface-guidelines/materials

Web adaptation, not a native AppKit implementation or a claim of exact Liquid Glass rendering.

## Site-wide system

- One system font family, explicit hierarchy, tabular timing values.
- Toolbar/navigation material is translucent; chart and data surfaces stay solid.
- Consistent raised, inset and panel elevations in both themes. Motion is short and interaction-driven; charts themselves do not bounce or float.
- Driver source list: fixed rank/logo/name/check columns. Names stretch from the same leading edge. No inherited pill border or trailing alignment.
- Runs: inset segmented group with a raised selected segment. Laps and fastest actions use the shared selection accent.
- Comparison tray: independent, keyboard-focusable reference and removal buttons.
- Comparison summaries: common header alignment, three sector cells and four equal weather columns.
- Corner navigation sits above detail/map columns. Narrow spaces stack these panels without reducing canvas height.
- Dropdowns share one open/closed behavior, including the more-specific Grand Prix selector. Selected options show checkmarks.
- Reduced motion, reduced transparency and increased-contrast preferences remain supported.

Official team/tyre asset provenance is recorded in `assets/official-sources.json`. These remain third-party marks, not euV2 branding. Historical teams without a verified asset retain a team-color fallback rather than an incorrect successor logo.
