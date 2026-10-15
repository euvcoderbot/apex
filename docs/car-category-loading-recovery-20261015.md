# Car-category loading recovery — 15 October 2026

The v113 qualifying recovery did not cover raw race telemetry or pit visits. On a cold backend, FastF1 can return classification without lap timing after the primary archive refuses the request and its mirror has no matching path. Empty timing is not evidence that a race never happened. A calculated chart cache alone cannot recover new driver/model views after an invalidation.

## Changes

- Retain exact completed-session source inputs, not old model scores: Singapore 2026 Q/R and Bahrain-labelled Sepang 2026 Q/R. The bundle now includes 22 Singapore and 70 Sepang native race laps, in addition to 32 qualifying laps. Source hashes, original expiry, driver/lap identity and official lap clocks remain attached.
- Existing hashed native requests verify identity. Additional Singapore native recordings require exact official lap duration, same UTC event date and a common UTC session origin supported by at least three independent drivers; ambiguous multi-driver origin clusters are rejected. Native time/speed samples are never altered by capture.
- Race eligibility still uses the entire timing session for stint medians and traffic screening. Only then intersect with the retained native inventory, before representative selection and work-budget planning. Otherwise the planner picks unavailable laps and discards an available teammate or bridge cohort later.
- Recompute current-model corner windows and connected comparisons. Known displaced recordings remain excluded and are not automatically downloaded repeatedly; explicit Refresh may try the live archive.
- Retain raw pit visits with exact stationary/lane durations kept separate. Expired lane records can be returned only after live failure, visibly marked stale. The separate stationary publication is still attempted using verified race date, driver identity and exact in-lap, even if lap telemetry is unavailable.
- Native caches may migrate across the two compatible releases. Session payloads cannot: their newly required telemetry inventory must refresh. Only unexpired results explicitly carrying the identical v12 methodology marker migrate; older v8 scores never do. Original expiry is preserved, and recording-backed TTLs cannot extend it.
- Race-pace summaries are optional for the race-corner plan, rather than an unrelated all-or-nothing dependency. Category source notices cover pits too. Pending straight/braking loads no longer display a premature empty-measurement conclusion.

## Observed checks

| Category | Singapore 2026 check |
| --- | --- |
| Pace | Q and R summaries HTTP 200, 11 team rows and 11 race estimates |
| Qualifying corners | 11 teams supported in the existing current calculation |
| Race corners | Previously no native recordings/snapshots on cold recovery; now four supported retained cohorts connect all 11 teams and 15 drivers |
| Broader age-adjusted race corners | Same four retained cohorts; 11 teams / 15 drivers identifiable in the replay |
| Straight line | 11 team traces / 21 eligible driver traces returned; browser shows all 11 settled-window and top-speed rows; selected 250–300 range supports 9 teams, not an invented 11 |
| Braking | Browser supports all 11 teams in the independent slowing view, six connected zones; this is distinct from stricter paired approach support |
| Pit stops | Previously HTTP 422 on fresh source failure; now 25/25 stationary and lane visits, visible chart/table and source notice |
| Tyre trend | 76 retained run inputs; browser renders all 11 team trend rows |
| Development | Single-GP selection correctly explains that a multi-event trend is unsupported |
| Reliability/results | Browser renders all 11 teams with retained official classification/points |

Sepang replay connects all 11 teams and 18 drivers in the matched race-corner view. Eight candidate groups include displaced source recordings and remain rejected. Its driver age-adjusted fit is not independently identifiable and explicitly says to use matched ages. Pit timing returns 73 lane visits / 72 stationary timings; the remaining stationary value is unknown, not zero.

These are loading/recovery improvements, not a claim of more measurement precision. Retained Singapore race coverage is four distinct laps and remains provisional; it is not every lap of the race. Japan 2025 cold Q/R summaries still fail when upstream archives are unavailable and no complete retained source exists; pit availability was intermittent (422 initially, 200 with 21 visits on the follow-up). No event/year substitution or fabricated weather/telemetry is used.

Regression commands: `node --test scripts/test-*.mjs`; run each `scripts/test-*.py` using the project virtual environment. The new eight-mode race replay tests actual native recordings and checks unsupported fits explicitly. `scripts/audit-car-loading.mjs` writes compact HTTP/cache/coverage results; `APEX_AUDIT_SNAPSHOTS=1` also exercises source-backed snapshots. Browser QA covers all eight category tabs for Singapore, not every season/event combination.

To rebuild recordings, run `scripts/capture-source-recordings.py` followed by `node scripts/extend-source-recordings.mjs`; the base capture alone replaces the bundle and omits the extensions. Source cache files are local inputs and must not be committed. Never extend their original expiry during capture.
