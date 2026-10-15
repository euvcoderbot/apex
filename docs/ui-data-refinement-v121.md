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

Singapore currently has **1,240 timing-lap records**, **1,006 condition-eligible timing laps**, but only **22 retained native driver-laps**. Those support four matched groups and all 11 connected teams, with only 1–4 measured laps per team. A production `fresh=true` session request still returns `verified-recording` with `refresh_failed=true`. There is no full native race stream available from that refresh. Lap times cannot reconstruct corner traversal timings.

Therefore this release does **not** claim to have recovered full-race Singapore corner telemetry. The source counts and sparse/provisional limitation are displayed beside the result. Synthetic tests verify that an available 55-lap race keeps its late laps, and larger cohorts exceed the former 96-group cap.

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

- 187 JavaScript tests, including full-race planning, table layout, sprint aggregation and cache safeguards.
- 115 Python tests across nine scripts, including low-speed throttle-ramp preservation, braking rejection, classification identity and retained-source outage recovery.
- Native Singapore team/driver archive replay with dimensional/partition checks; live API low-band and braking-coverage checks.
- Browser checks of sprint totals, all 11 low-band teams, all 11 race-cornering teams, sidebar geometry, compact-table fit, desktop and 390 px layouts.
- The raw telemetry cache can migrate the unchanged v120 sample format while derived measurements receive a new methodology identity.

References: [Microsoft Mica](https://learn.microsoft.com/en-us/windows/apps/design/style/mica), [materials](https://learn.microsoft.com/en-us/windows/apps/develop/ui/materials), [navigation](https://learn.microsoft.com/en-us/windows/apps/design/basics/navigation-basics), [Jolpica sprint schema](https://github.com/jolpica/jolpica-f1/blob/main/docs/endpoints/sprint.md), [OpenF1 session results](https://openf1.org/docs/).
