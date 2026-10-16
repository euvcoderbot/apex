# Fluent UI and coverage corrections — v121

## Design and layout

- Applied a neutral purple-grey, Mica-like canvas to both workspaces, with Segoe UI typography, subtle content layers and restrained shadows. This is a web approximation: CSS cannot sample the desktop wallpaper like native Windows Mica.
- Replaced the car category strip with Settings-style vertical icon navigation on desktop. Mobile uses a two-column category grid without a horizontal scroller. Kept the stable two-section selector in the header.
- Used acrylic blur on header/flyouts, not behind dense data. Retained light theme, keyboard focus and reduced-transparency/contrast fallbacks.
- Removed the legacy forced horizontal-navigation CSS, including its conflicting `!important` rules.
- Fixed the driver/tyre sidebar: stacked cards, a scrolling driver list, and a non-growing tyre card. The cards share an x position and width; they no longer overlap.
- Tables with six or fewer columns fit their container and wrap labels. The measured five-column race table is 501 px wide with a 501 px scroll width at the tested desktop viewport.
- Added a compact six-column results summary. The detailed reliability fields remain available in a disclosure instead of forcing the primary view to scroll through fourteen columns.
- Added vertical arrow-key navigation; Ctrl+Home no longer gets intercepted by the category control.

## Singapore 100–150 km/h

The exact saved team laps contain complete native crossings. The prior 70% throttle floor rejected almost every crossing because drivers were still applying throttle on corner exit. This was a definition/filter problem, not an absent speed channel.

Up to 150 km/h now measures **delivered corner-exit acceleration**, including throttle application, turning and traction. It does not claim isolated engine performance. Bands above 150 km/h still require at least 98% throttle. Brake-free crossings, native gaps at most 0.6 s, aero-state matching, physical-zone matching, native-speed plausibility and fastest-qualifying-lap-only selection remain enforced.

Exact saved-source replay:

| Team speed band | Previous supported entries | Revised supported entries |
| --- | ---: | ---: |
| 100–150 | 0 | 11 |
| 150–200 | 10 | 10 |
| 200–250 | 10 | 10 |
| 250–300 | 9 | 9 |
| 300–320 | 0 | 0 |

The saved driver replay now supports 21 drivers in 100–150. These are coverage improvements after redefining the low-speed metric, not proof of increased physical accuracy. The production API and browser both verify all 11 teams in Singapore 100–150.

## Race cornering: source limit versus processing limit

Removed the six-observation stopping target and 96-group cap. The planner now processes every eligible available cohort. Explicit small budgets remain possible for diagnostic callers. Improved planning by indexing stint times once and prioritising early coverage before consuming remaining groups chronologically. Removed the duplicate legacy-window calculation from each race snapshot and limited progressive UI repaints to four per second.

Singapore has **1,240 timing-lap records**, **1,006 condition-eligible timing laps**, and **22 retained native driver-laps**. The previous planner treated that retained inventory as a hard availability limit. It therefore selected only four matched groups and 1–4 measured laps per team.

A fresh FastF1 timing request still falls back to its recording, but **that does not mean OpenF1 native laps are unavailable**. A separate exact-lap probe recovered VER L11, followed by eight drivers' L16 traces. All eight passed alignment checks and supported all 19 corners. The source-selection assumption, not race size, was the main coverage bug.

The planner now checks an eligible non-retained native lap before imposing an offline inventory limit. A verified live response unlocks all eligible groups; an actual failure retains the offline fallback with its reason disclosed. Singapore's team plan now includes **123 matched groups / 496 distinct selected driver-laps** over the race. Individual packet/window checks still apply, so planned counts are not presented as successful measurements. Lap times never reconstruct missing corner telemetry.

The initial per-lap recovery run hit OpenF1 rate limits. Added a driver-level full-race endpoint: fetch car, location and lap streams once per driver, then reuse the original timing-boundary/interpolation code to split laps. Compact numeric arrays reduce transfer size. Only one bulk-driver fetch runs at once; rate limits start a shared cooldown rather than another flood of requests. Completed results remain available.

The batched Singapore run completed **all 123 team groups and all 123 driver groups without errors** in approximately **156 seconds**, with **25 dashboard-to-backend requests total**. All 11 teams rank with 25–66 unique measured driver-laps each (Red Bull 51, Mercedes 32, Ferrari 40), instead of 1–4. All 21 eligible drivers rank; individual coverage remains dependent on clean matched conditions. A fresh-cache-instance replay hit all 246 group results with zero upstream requests in under one second. The release bundles these current-version, unexpired compact results; no raw full-race streams are shipped to the browser.

Race-band fitting now calculates only the selected band and memoizes the result by observation set and controls, rather than recalculating all four bands on every display interaction.

## Braking coverage

The previous “Observed zones” count actually represented accepted shared-speed intervals, not all braking events. Renamed it to comparable intervals, exposed the candidate-zone denominator, and added per-zone reasons. Both braking approaches retain their existing paired measurements and quality requirements.

Production replay of Ferrari's fastest Singapore qualifying lap:

- Zones 1 and 5: do not cover the selected shared speed drop within the common straight window.
- Zones 3 and 7: no supported onset in that shared straight window.
- Zones 6 and 8: supported accepted intervals.

Thus 2/6 is not two braking applications in the whole lap. Packet gaps, brake releases and speed rebounds have separate exclusion labels. Unsupported values are not filled with zero or substituted from slower laps.

## Sprint points

Added a classification-only sprint endpoint using exact year/round/event identity, with Jolpica and OpenF1 sources. It does not load sprint telemetry. Total points add race and sprint classifications; the summary shows both contributions. Race points per race start, finishes and reliability denominators remain race-only. Missing sprint points make the total unknown, not zero. Driver-code joins use the race roster to avoid constructor-name mismatches.

Production checks: Singapore 2026 returned 22 classified drivers / 36 sprint points; China 2025 returned 20 / 36. Browser Singapore totals include Ferrari 26 race + 13 sprint = 39, Red Bull 26 + 8 = 34, Mercedes 17 + 5 = 22.

## Verification

- 190 JavaScript tests, including full-race planning, live-source versus retained-inventory regression checks, bulk concurrency/cooldown, table layout, sprint aggregation and cache safeguards.
- 116 Python tests across ten scripts, including low-speed throttle-ramp preservation, race-stream request reuse, braking rejection, classification identity and retained-source outage recovery.
- Native Singapore team/driver archive replay with dimensional/partition checks; live API low-band and braking-coverage checks.
- Browser checks of sprint totals, all 11 low-band teams, race-cornering availability, sidebar geometry, compact-table fit, desktop and 390 px layouts.
- The raw telemetry cache can migrate the unchanged v120 sample format while derived measurements receive a new methodology identity.

References: [Microsoft Mica](https://learn.microsoft.com/en-us/windows/apps/design/style/mica), [materials](https://learn.microsoft.com/en-us/windows/apps/develop/ui/materials), [navigation](https://learn.microsoft.com/en-us/windows/apps/design/basics/navigation-basics), [Jolpica sprint schema](https://github.com/jolpica/jolpica-f1/blob/main/docs/endpoints/sprint.md), [OpenF1 session results](https://openf1.org/docs/).
