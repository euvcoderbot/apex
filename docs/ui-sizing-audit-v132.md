# UI sizing correction — v132

This revision addresses the five screenshots from 17 October 2026. It supersedes v131's decision to collapse the primary straight-line charts.

## Common scale

- Regular buttons, category tabs, filter pills, pop-up fields, map selections and zoom actions: 30 px high, with 12 px control text. Coarse-pointer targets use the existing 44 px accessibility alternative.
- Data/control text: 12 px; supporting captions: 11 px; section headings: 14 px; prominent lap time: 16 px; page heading: 22 px. These are deliberate hierarchy levels, not arbitrary per-category sizes.
- Spacing tokens: 4, 8, 12 and 16 px. Regular controls use 8 px horizontal padding, outer panels use 12 px, and inner chart/table surfaces use 8 px.
- Multi-line data records such as driver and lap choices remain content-sized. Checkbox glyphs and tyre icons are not enlarged to the size of entire buttons.

The root cause of the pill mismatch was inherited fixed-height shells combined with minimum-height buttons and wrapping text. Segment shells now grow naturally; their buttons use the same fixed regular size as the category navigation. Shortened cornering labels avoid two-line controls. Whole choices wrap when space is limited.

## Screenshot fixes

1. Circuit inspector: one continuous panel, with a map toolbar, then labelled Corners and Straights groups, then selected-section measurements. Uniform selection grids replace loose rows. Other links have their own disclosure and retain their uncertainty label.
2. Comparison table: removed the 650 px vertical cap from main chart/table pairs. The page scrolls naturally; wide tables can still scroll horizontally. In the live 21-driver test, chart and table heights and first-row positions matched; table clientHeight and scrollHeight were both 772 px.
3. Category sizing: navigation, Teams/Drivers, Qualifying/Race, speed bands, pit statistics, tyre choices, trend choices and results choices all share the regular pill metrics. Header, data and caption roles share the type scale above.
4. Straight line: all three primary charts are visible by default again. Acceleration ranges are eight compact pills, not a dropdown; unsupported ranges remain disabled. Results measures are also pills. Range selection retains focus and updates the acceleration heading/data.
5. Unranked footer: removed the repeated count/footer. Missing observations remain explicitly unavailable within the data, rather than being turned into zero or quietly presented as measured results.

Detailed measurement tables remain in their existing disclosures; only the primary straight chart group was restored to always-visible presentation.

## Verification

- Browser: all eight performance categories at 1280, 1024, 768 and 390 px. Every visible category/filter pill measured 30 px high with 12 px text; no clipped button labels or page-wide horizontal overflow in the cached Singapore replay.
- Browser: driver cornering chart/table retained all 21 rows without a nested vertical scrollbar, with equal card heights and identical first-row positions.
- Browser: all three straight charts visible outside disclosures, equal card heights and identical first-row positions. Speed-range selection changed the pressed state and retained focus.
- Browser: results measure selection changed its pressed state; all four choices measured 30 px / 12 px.
- Browser: circuit corner and straight buttons measured 30 px / 12 px, with no clipped labels at 390 px. Map and traces remained present together; corner table sort buttons also measured 30 px / 12 px.
- Automated suite: 219 passing tests, including four new sizing/structure regressions. Rendering/measurement models, source cache expiry and telemetry eligibility were not changed.
- Production build: completed successfully. The existing Vinext route-classification advisory remains non-fatal.

The browser checks use retained Singapore data, not every event or real-device touch input. Native macOS materials/fonts are still platform-dependent; this remains a web interface. Existing source caches and local processing were preserved.
