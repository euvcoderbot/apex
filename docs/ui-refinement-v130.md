# UI refinement — v130

## Screenshot issues addressed

1. **Lap chooser:** a legacy sidebar `grid-row: 2` caused automatic placement of stint cards in the 220 px driver column. Explicit placement now puts Drivers in column 1 and lap cards in column 2. Small screens stack those regions. Driver headers no longer ellipsize names into `Ma…`/`Le…`.
2. **Lap and sector differences:** gain/loss precedes the measured lap time and each measured sector time, both in markup and visual order.
3. **Lap identity:** code/reference and tyre details occupy one header group; redundant lap numbers are removed from this summary identity. Source lap numbers remain in selection controls and accessible reference/remove labels.
4. **Trace choices:** visibility, driver code, exact recorded time and colour well form one compact outlined control. Times such as `HAM 1:31.496s` replace `HAM L21`; internal lap keys and the last-visible-trace safeguard are unchanged.
5. **Sector summary:** larger 13 px S1–S3 labels, 5 px bars and vivid purple/green/yellow. Weather icons sit in one aligned strip. Reference/compared rows share the same layout.
6. **Navigation:** requested emoji icons appear inside a single attached metric navigation group, with the selected tab distinguished from hover.
7. **Tyre options:** one labelled compound pop-up replaces the overlapping compound strip. All C grades/compounds remain selectable. Fuel controls and their short assumption line are aligned separately. Detailed interpretation remains under Show explanations.
8. **Race scope:** selecting Tracks directly shows races, count and batch actions. The redundant Choose races disclosure, its arrow and automatic closing after Analyse are removed.
9. **Menus:** single downward vector chevrons replace the opposing-arrow glyphs; no arrow-flip animation.

## Unchanged

No source telemetry, eligibility, timing calculations, speed bands, fuel assumption, ranking method or pit-stop logic changed. This is a presentation and control-layout release.

## Timing colours

The purple/green/yellow meanings follow [Formula 1's sector glossary](https://www.formula1.com/en/latest/article/f1-glossary-p-t.GBhLQtpeu9b8LrK5VM0F1). The brighter CSS colours are broadcast-style approximations, not a claim that F1 publishes these exact hex values as an official design specification.

## Verification

- 212 JavaScript checks, including new rendered delta-order, weather-icon, exact trace-time, explicit grid-placement and compound-menu tests.
- Live qualifying comparison: HAM 1:31.496 versus VER 1:31.373; changing reference correctly shows VER −0.123s without altering measured times.
- Live DOM measurement: stint area grows from the broken 220 px placement to about 964 px at the tested desktop viewport.
- Checked phone stacking, untruncated driver names, direct race-list visibility after Analyse, compound selection and focus restoration.
