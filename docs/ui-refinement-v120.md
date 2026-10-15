# UI refinement — v120

Addresses the seven supplied screenshots, plus the supplied euV2 logo.

- Stable, centred two-option primary navigation; Hide drivers moved into the session workspace.
- Theme/explanation controls moved to a separate display-options row.
- Run controls use a wrapping grid with no forced 150 px minimum or horizontal scroll strip.
- Select text has explicit line height and vertical room; flags no longer clip at the text edge.
- Source notes, regulatory detail and optional prose follow Show explanations; error/quality notices remain visible.
- Shorter page headings and table guidance; redundant chart footer removed.
- Mica-inspired tinted base, layered surfaces, acrylic header/flyouts and restrained elevation, following
  Microsoft's guidance to keep readable content opaque and avoid multiple overlapping glass layers.
- Solid fallbacks for reduced transparency, higher contrast and forced colours.
- Collapsed race picker is a compact edit row; bulk actions appear only while expanded.
- Tyre inspector includes short/unfitted recorded runs when present in the source; no trend is fabricated.
- Full-width stint selector and recorded lap-time table, including excluded-lap reasons.
- Development table uses real-point sparklines on a common scale, shorter headers, neutral GP counts and
  explicit gain/loss values. Missing-round gaps are not joined. Sensitivity is shown only when supported.
- User-supplied logo replaces the old header image, favicon and touch icon. The original artwork is preserved;
  its existing wordmark and square gauge are exported as lightweight desktop/mobile/browser assets.

No numerical ranking method or upstream telemetry API changed. The stint inspector cannot show laps that
the source has not returned; it no longer discards returned runs merely because they have no supported fit.

Design references:
- https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic
- https://learn.microsoft.com/en-us/windows/apps/design/style/mica
