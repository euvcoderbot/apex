# Car-performance redesign and before/after verification

Baseline: published version 111, commit `50756fa55eec82fd0f2292007f487163b492fdb9`.
Verification date: 15 October 2026. The machine-readable companion is
[`methodology-comparison-20261015.json`](methodology-comparison-20261015.json).

## What changed, category by category

| Area | Implemented | Interpretation / control |
| --- | --- | --- |
| Sources | Per-channel provenance; verified same-lap FastF1/OpenF1 supplementation only for serious missing coverage; duplicate packets counted once; conflicting values never averaged. | UTC origins must agree. Interpolation is not an independent observation or a higher sampling frequency. Automatic source recovery is bounded to avoid downloading two feeds for every ordinary lap. |
| Alignment and eligibility | Preserve valid local intervals when an isolated packet, frozen patch or GPS interval is corrupt. Keep native peaks even without usable spatial registration. | Bad intervals remain excluded, not repaired into synthetic speed observations. Incomplete local coverage cannot produce a complete-lap attribution. Sector alignment tolerance was not relaxed. |
| Season aggregation | Direct mean solution; robust absolute-residual median fit; equal total GP weighting; identifiable comparison components; convergence, residual and leave-GP-out diagnostics. | Common observed coverage remains distinct from the optional coverage-adjusted diagnostic. Different disconnected components do not share a fictitious zero. |
| Qualifying pace | Official fastest valid qualifying lap remains the delivered-performance headline. Add a timestamp/fresh-set condition diagnostic inside common observed time support. | Separate selectable diagnostic, not an official time correction. Refuses sparse or confounded fits; no extrapolation to Q3. |
| Race pace | Supported compound-age hinge terms, robust fitting and driver-contrast identifiability checks; preserve an identifiable main group rather than blanking it for a disconnected driver. | Nonlinear / previous linear model toggle. Traffic and leave-stint-out tests are sensitivity checks. Fuel loads, driving targets and continuous traffic are not measured. |
| Qualifying corners | GPS turning envelopes with named-corner landmarks and bounded neighbour-aware geometry; approach, turning, 50/100 m exit evidence. | Turning envelope / fixed-distance window toggle. Approach is not labelled pure braking. Estimated bend centres are not measured physical apexes. |
| Corner classes | Shared qualifying classification reference for qualifying/race where supported, actual reference speeds and borderline flags. | Low/medium/high thresholds are disclosed dashboard conventions, not a universal FIA grading standard. Fallback geometry/classification remains uncertain. |
| Race corners | Adaptive acquisition targets rather than the former fixed 24-group cap; unique physical observations, balanced comparison weights. | Matched-age view plus separate broader age-adjusted estimate. The broader fit needs independent age variation and refuses confounded driver/age effects. Budget is bounded at 96 groups. |
| Acceleration | Preserve local native crossings independently of unrelated full-lap failures; known aero-state screening and per-band crossing evidence. | Low-speed bands remain traction-affected. Reaching an upper speed somewhere else is not a complete acceleration crossing. Missing ranges stay missing. |
| Settled straights | Shared settled geometry/state windows, tighter-boundary sensitivity, entry/exit speeds and exact window timing evidence. | Delivered windows / stricter entry-matched toggle. Matching entry speeds can legitimately reduce the cohort; it does not silently substitute another qualifying lap. |
| Top speed | Native peak retained independently of spatial eligibility; terminal corridor and official trap measurements remain separate. | No conversion into isolated drag coefficient, horsepower or engine ranking. Setup, tow, deployment and active aero remain confounders. |
| Braking | Both comparisons remain tied to exact fastest qualifying laps; explicit common endpoints, lap/cohort/window evidence, bracket resolution, endpoint sensitivity and bounded-assumption envelopes. | Same-speed deceleration is not fixed-distance traversal. Mixed-speed G/power averages removed from the headline table; per-zone energy proxy is explicitly not friction-brake power. Impossible assumption envelopes return unavailable. |
| Tyre-age trend | Robust supported piecewise warm-up/steady/late trend, preserving sustained late falloff; full observed ages; verified C-grade views; fuel sensitivity choices and GP/grade cohort option. | Steady nonlinear / whole-run linear toggle. Own-run absolute slopes, not rival-subtracted values. Curves never extrapolate beyond observed ages or predict remaining tyre life. |
| Pits | 10% trimmed and capped means, robust distribution metadata, exact visit evidence and eligibility/context distinctions; consistent chart/table sorting. | Existing mean/median/quickest/spread/tail views retained. Trimmed/capped means and P10/P90 need ten visits. A long service stop is not automatically reclassified as a penalty or repair. |
| Development / reliability | Optional rolling three-measured-GP median display, with unchanged ranking; mechanical events per 1,000 official completed laps when exposure is complete. | No invented missing rounds, causal upgrade claims or guessed retirement causes. Unknown official exposure stays unavailable. |
| Speed / caching / UI | Indexed source-window extraction, independent source/backend/race cache revisions, reusable season summaries, lazy detailed evidence, corrected common-tyre GP counts and sparse-data explanations. | Stable source data and calculated outputs are cached separately. Methodology changes invalidate relevant results. Raw observations, estimates, assumption sensitivity and unsupported values remain distinct. |

## Measured before/after results

The replay uses the **same exact-fastest-lap recordings**, not a switch to more favourable laps.
Eleven team/driver cohort replays span nine GP/year cases: Singapore and Bahrain 2026,
Azerbaijan 2026, Portugal 2021, and Britain, China, Italy, Japan and Monaco 2025.
Source hashes and every entrant's old/new measured values are in the JSON companion.

| Check | Version 111 | New implementation |
| --- | --- | --- |
| Singapore spatially supported teams | 10 / 11 | 11 / 11 |
| Singapore spatially supported available drivers | 18 / 21 | 21 / 21 |
| Singapore drivers with supported braking evidence | 18 | 21 |
| Singapore supported driver braking intervals | 54 | 82 |
| Singapore driver 200–250 km/h comparison coverage | 18 | 20 |
| Singapore driver 250–300 km/h comparison coverage | 16 | 17 |
| Japan 2025 spatially supported teams | 9 | 10 |
| Monaco 2025 spatially supported teams | 8 | 10 |
| Unchanged braking endpoints, 291 matched intervals | Reference timings | Maximum time change **0.000 s** |
| Arithmetic / consistency checks over replay outputs | — | **0 errors** |

These are coverage and internal-consistency improvements, **not independent proof of physical accuracy**.
Some ranges genuinely remain unsupported: for example, this Singapore team corpus still has no
three-entrant clean 100–150 km/h cohort, and no representative reaches 320 km/h on those selected laps.
The 21 available driver recordings are not a claim that every possible entrant had usable source data.

### Actual-value example: Singapore Red Bull

| Measurement | Old | New | Why |
| --- | --- | --- | --- |
| Native selected-lap peak | 308.000 km/h | 308.000 km/h | Real native speed did not change. |
| Supported braking intervals | 4 | 5 | A valid local interval survives unrelated source-quality exclusions. |
| Settled straight gap | +0.039 s | +0.154 s | Changed shared boundaries/cohort: measured length changed from 290.072 to 255.063 m, and recovered Aston observations change the reference. **Not a like-for-like change in Red Bull hardware performance.** |
| Strict entry-matched settled gap | Not offered | Unsupported | This exact lap does not share the required complete entry-speed-matched cohort. No value is manufactured. |

Aston's native peak remains 302.000 km/h. Its recovered settled-window gap is 0.000 s on this
small supported selection; that does **not** mean it has the best engine or lowest drag, nor
does it override the independent top-speed statistic. Entry/exit speeds, selected windows and
cohort evidence are available to examine this distinction.

### Known-truth tests: accuracy of the estimator, not team reputation

- A synthetic connected chain has a known final contrast of **0.210 s**. The old stopped
  iteration returned **0.125 s (mean)** / **0.040 s (median)**. Both new fits recover **0.210 s**
  to floating-point tolerance. The maximum contrast error falls from 0.085/0.170 s to below
  `5e-14 s` in this exact synthetic test.
- Adding one non-overlapping driver previously erased the supported A/B/C race comparison.
  The new identifiability partition retains A/B/C and leaves the disconnected driver unranked.
- A 30-lap synthetic stint with real late falloff previously retained only 26 laps. The new
  screen retains all 30 and recovers **+0.030 s/lap steady**, **+0.530 s/lap late**, with the
  known change at tyre age 20. This is a recovery test, not a forecast of real tyre life.

## Performance results and limits

Index construction plus 22 window selections from 20,000 source records fell from a
five-run median **0.987 s to 0.047 s**, about **21.2× faster**. Network/download time is excluded.
This benchmark is source selection only, not total dashboard load time.

Extra geometry, local-quality and sensitivity work increases cold `measure_field` cost:
the Singapore team replay is about **0.652 → 0.851 s**, and the driver replay
**1.146 → 1.617 s** in these runs. Caching and summary reuse prevent paying that cost on every
display toggle. CPU times are environment-specific single runs except the explicitly five-run
index benchmark. No language rewrite was justified by this measured bottleneck.

Automated verification: **157 JavaScript + 103 Python tests passed (260 total)**, plus the
eleven replay arithmetic checks and the 291 unchanged-endpoint timing checks. Live API checks
confirmed v12 Q/R output, nonlinear race-model metadata, 76 Singapore stint curves, and all
11 Singapore team traces with supported braking evidence. Browser checks covered the new
pace, pit, tyre and straight-line controls; this is not exhaustive full-season visual QA.

## Research ideas deliberately not presented as validated measurements

GP deletion ranges, speed-endpoint changes, boundary trims and fuel choices are **sensitivity**,
not statistical confidence intervals. A GP-cluster bootstrap or held-out uncertainty-aware
smoother has not been validated here and is not presented as such. The existing session
interpolation option is not promoted into extra independent car-performance samples.

A hierarchical/state-space tyre model, inferred brake pressure, remaining tyre life,
isolated horsepower/CdA, continuous clean-air reconstruction and penalty/repair causes are
not established by these public inputs. The supported piecewise tyre model and explicit
assumptions are used instead of unvalidated physical claims. No missing team's score is
filled merely to make the ranking match expected team order.

## Reference methods and source limits

- [OpenF1 API documentation](https://openf1.org/docs/) — native channels and documented DRS codes.
- [FastF1 telemetry source](https://github.com/theOehrly/Fast-F1/blob/master/fastf1/core.py) — original versus merged/interpolated channels.
- [Formula 1 / AWS braking explanation](https://www.formula1.com/en/latest/article/rob-smedley-explains-how-the-new-aws-braking-performance-graphic-works-and.3A8cnQLZGXFbMjCR2fFBnB) — richer broadcast model; not reproducible as exact friction-brake power from public sparse speed/brake flags.
- [Formula 1 car-performance scores](https://www.formula1.com/en/latest/article/rob-smedley-on-car-performance-scores-and-the-data-behind-the-latest-f1.5QoyFi4KL63EULKM4u5mGL) — context for separating performance facets rather than claiming one telemetry statistic isolates hardware.
- [DHL Fastest Pit Stop Award](https://inmotion.dhl/en/formula-1/fastest-pit-stop-award) — published stationary timing source, kept separate from pit-lane duration.

Replay tools: `scripts/methodology-replay.mjs`, `scripts/methodology-replay.py`,
`scripts/capture-methodology-corpus.py`, `scripts/write-methodology-comparison.py`, and
`scripts/benchmark-window-index.py`. They consume the retained local evidence files named
in the JSON report; those large raw recordings are not bundled into the website.
