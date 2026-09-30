# Cross-circuit metric retest — 30 September 2026

## Scope and result

This is a diagnostic audit, not a deployment or an implementation of the recommendations below. No production metrics were changed during this retest.

- 14 events: 2018 Bahrain; 2021 Portugal; 2025 Japan, Italy, Azerbaijan, Monaco, Britain, Hungary, Canada and Netherlands; 2026 Japan, Italy, Azerbaijan and Canada.
- Qualifying and race API responses for every event, plus supplied pit visits.
- 429 candidate qualifying laps and 132,772 native telemetry samples. The replay uses the dashboard's unique candidate identifiers and matching metadata.
- Baseline field analysis plus second/third candidate field replays: 42 field analyses in total. Alternate comparisons reported below require the same driver, compound and qualifying phase, and a different lap.
- 660 tyre runs containing 11,966 fitted points; 585 runs marked supported by the current model.
- 488 pit-lane visits. Missing stationary measurements remain missing.
- 127 existing automated tests pass: performance 45, session loader 3, server performance 10, pit timing 5, year boundary 2, UI logic 45, telemetry 17.

No arithmetic failures were found in the tested qualifying deficits, full-lap partitions, corner percentage conversions, straight-section seconds/percent conversion, tyre slope recomputation or fuel shifts. The alternative replays also pass their partition checks. An additional 1,193 braking measurements across all replays pass the mean-deceleration, distance-normalized deceleration and specific kinetic-power formulas.

**Passing arithmetic does not establish valid car-performance rankings.** The principal failures concern observational support, changing measurement windows, confounding and sparse-model assumptions.

Raw evidence: `C:/Users/eufra/Documents/Codex/2026-07-10/build/metric-audit-evidence.json`. Reproduce with `scripts/audit-metric-matrix.py --output <absolute-output-path>` using the project's Python environment. This file is an audit snapshot, not a dashboard cache.

## Highest-priority findings

### 1. Provisional braking observations enter the headline ranking

**Observed, high priority.** Of 439 baseline team-zone measurements, 227 are labelled provisional. `eventTelemetry()` accepts them when duration and speed drop are present; it does not require `quality === 'supported'` before estimating the ranking.

- 2025 Britain: all 18 available measurements are provisional.
- 2026 Japan: all three available measurements are provisional.
- 2025 Hungary: an Aston Martin measured speed reduction lasts 0.302 s, while its two endpoint sampling brackets sum to 0.721 s. That bracket sum is a resolution diagnostic, not a formal error bound, but it is larger than the measured event and the current model marks the observation provisional.

The formulas are internally correct, but sub-sample estimates can determine a seemingly precise order. Repeated qualifying laps are already used in matched braking where driver, compound and phase agree, which is preferable to inventing finer sampling.

**Recommended:** separate supported-only ranking from an explicit provisional evidence view. Report sensitivity to removing weak zones; avoid confident ordering when differences are below resolution/repeat variation. Broaden candidate retrieval for real repeat evidence. Do not infer pressure or isolated brake hardware power from public brake state.

### 2. Statistical tyre support is mistaken for environmental suitability

**Observed, high priority.** Tsunoda's 2025 British GP medium run is marked supported and clean-air-supported with a raw slope of **−1.147 s per tyre-age lap**. The six retained laps go from 95.637 s to approximately 91 s. A small residual error establishes a consistent time trend, not that the trend measures tyre degradation.

Rainfall false and a slick compound do not establish a stable dry surface. Drying, warm-up, driving targets, traffic changes and deployment may dominate the trend. A robust regression does not remove a smooth systematic improvement.

The explicit fuel shift is correctly applied: +0.060 s per race lap. Fuel sensitivity scenarios are assumptions, not independently identified fuel effects. Within an uninterrupted stint, tyre age and race lap advance together, so their effects cannot be separated from those data alone.

**Recommended:** retain these runs as observed pace-change evidence but exclude or flag changing-condition runs in a degradation headline. Detect and display environmental/common-field time trends, stable warm-up periods and management changes. Do not clip negative slopes simply to create an expected team ranking. Compare common GP/compound coverage and report driver/stint sensitivity rather than relying only on six-lap support.

### 3. Acceleration ranking is substantially lap- and model-dependent

**Observed sensitivity and demonstrated model limitation.** Across comparable alternate field replays:

| Metric | Paired observations | Median absolute change | Maximum absolute change |
| --- | ---: | ---: | ---: |
| 150–200 km/h fitted gap | 41 | 0.046 s | 0.295 s |
| 200–250 km/h fitted gap | 60 | 0.077 s | 0.273 s |
| 250–300 km/h fitted gap | 45 | 0.287 s | 2.865 s |
| 300–320 km/h fitted gap | 33 | 0.211 s | 1.540 s |

The largest 250–300 change is Ferrari, 2026 Italy, laps 14 and 17: 0.499 to 3.364 s relative to the respective comparison models. It is not a directly observed extra 2.865 s on one fixed straight: other entrants, the baseline and zones can change in the alternate field replay. The distinction is crucial.

The additive connected-zone model assumes a car has approximately one effect across the observed zones. A controlled counterexample demonstrates failure under missing car-by-zone interactions: A takes 1 s and 4 s in two zones; B and C take 2 s and 3 s. Complete observations yield essentially equal effects. Hide A's second zone and the model gives A a 1 s advantage. Missing crossings are not random, so connectedness alone does not guarantee unbiased ranking.

**Recommended:** report measured crossing times, physical crossing locations, aero state and native resolution per zone. Add common-zone and paired-zone sensitivity views and explicit model residuals. Prefer same-driver/phase/compound repeat evidence; hold zones and reference fixed when assessing repeatability. Below 150 km/h label traction/exit observations separately. Do not call an inferred band effect isolated engine or aerodynamic efficiency.

### 4. Whole-lap validation unnecessarily couples independent metrics

**Observed coverage; improvement opportunity.** In 2026 Suzuka, baseline analysis retains five teams; second and third candidate field replays each retain two. Elsewhere the 2026 baseline retains ten at Italy and eleven at Canada and Azerbaijan.

Candidate retrieval is capped at three laps per constructor within 1% of its best. This is not an exhaustive search of qualifying. GPS/sector or frozen-speed rejection erases all downstream metrics for that lap, including native speed observations that do not require accurate full-lap spatial alignment.

The speed-integration check is also not an independent calibration: `Distance` was generated by integrating the same speed samples. Re-integrating reciprocal speed against that distance predominantly tests numerical consistency, not whether the speed channel is physically correct.

**Recommended:** progressive candidate expansion and channel/zone-specific eligibility. Retain clean native acceleration/braking/peak observations where appropriate, but keep GPS-dependent attribution unavailable when alignment is not supported. Diagnose repeated-speed shelves using GPS movement and multiple channel changes, not the other teams' speed variation alone. Never interpolate long stale sections into scoring evidence.

### 5. Peak-speed validation has an isolated-spike gap

**Controlled validation gap, not a proven bad production peak.** `prepare()` accepts a synthetic qualifying stream containing a single 999 km/h sample. It enforces minimum speed, finite channels and timing/distance checks, but no physical maximum or robust local spike check. The selected-lap peak later uses a grid-interpolated maximum, which can also differ from the native maximum.

Comparable alternate-lap peak changes in this matrix have a median of 1.176 km/h and maximum of 7.017 km/h. These may reflect tow, setup or deployment, not only measurement noise.

**Recommended:** independently screen native peaks and report corroborating neighbouring samples; retain rejected spikes as evidence rather than silently repairing them. Compare a fixed location/aero-state corridor separately from the absolute lap maximum. An absolute peak must not be presented as measured drag or engine power.

### 6. Pit-lane ranking pools service stops and non-service passages

**Observed and externally corroborated.** Canada 2025 contains 82 lane visits but only 33 supplied stationary times. Verstappen has timed stops on laps 12 and 37 and untimed lane visits on 67–69. The [FIA race report](https://api.fia.com/news/f1-russell-wins-canada-ahead-verstappen-antonelli-mclaren-pair-clash) explicitly confirms the field was routed through the pit lane under the Safety Car.

These are not duplicate rows or automatically invalid visits. The problem is pooling distinct visit types in a performance average. A pass-through without tyre service can appear quicker than a well-executed service stop. Portugal 2021 likewise has 60 lane visits with large whole-field groups on laps 2 and 3; those must be classified before interpreting the average as stop performance.

**Recommended:** distinguish confirmed service, mandated pass-through, penalty passage and unknown visits. Keep an all-visits diagnostic, but default service-performance comparison to service visits. Missing stationary time must not by itself classify a visit as non-service. Use tyre changes/age resets, race-control messages and supplied service timing as evidence. Do not invent stationary time from lane duration. Retain raw visit weighting and equal-GP relative weighting with their current distinct labels.

## Remaining category findings

### Settled straight sections and terminal speed

The conservative straight core is available in 12 of the 14 events, with measured baseline distance from 260 to 1,111 m. It is unavailable at 2025 Monaco and Hungary. Leaving out each constructor individually still does not restore either event under the current geometry and boundary rules; this is not simply one car erasing everyone's result.

Same-driver/phase/compound alternate field replays change the core gap by median 0.037 s, maximum 0.384 s. Terminal-speed changes reach 17.139 km/h, partly because the shared measurement corridors are redetected, not held fixed.

**Recommended:** report the share and identities of measured straights, freeze windows for repeatability checks, and test geometry/buffer sensitivity. Do not call a 260 m partial-window result whole-circuit straight performance. The seconds/percent conversions are correct; their season weighting meanings differ.

### Low/medium/high corners

No corner-window overlap or time-partition arithmetic error was observed. Comparable alternate field replays change lap-normalized category contributions by median 0.168 pp for low-speed, 0.142 pp for medium and 0.073 pp for high. Maximum low-speed change is 1.043 pp at Canada 2025, Williams laps 21 and 18.

Again, this combines lap, reference and segmentation changes. The default field-derived zone definitions and speed classes can change when the cohort changes. Small ranking differences need sensitivity context.

**Recommended:** fixed physical zones and field-derived speed classes for all laps in the event; evaluate repeat laps on those frozen windows. Report entry/apex/exit and traversal separately. Preserve the current lap-normalized time interpretation. A downforce index remains unavailable; speed and timing cannot isolate aerodynamic load.

### Race pace and race speed traps

Fastest-supported-teammate selection and reported driver/team minima pass the numerical check. Traffic-threshold sensitivity is substantial: Mercedes at Monaco 2025 changes from 0.686% to 1.381% across the existing 1.5/2.0/2.5 s scenarios. These scenarios refit and rebase the whole field, so they are not confidence intervals for an absolute driver time.

Britain 2025 has 91 eligible laps but no supported race-pace team contrasts. Wet/mixed-condition exclusion and model-identifiability limits must not be called a loading failure. Shared race-lap/compound/linear-age effects and checkpoint gaps do not identify full-race clean-air potential, driving targets or driver-specific tyre response.

**Recommended:** common-cohort threshold comparisons, practical conditioning diagnostics, model residuals by compound/stint/age and leave-stint-out sensitivity. Separate supported pace from unavailable car-potential inference, especially Monaco. Race speed traps still combine tow, tyre, pit strategy and deployment; their comparison is not interchangeable with qualifying.

### Qualifying pace and development progression

Fastest official lap across Q1/Q2/Q3 and its percent/seconds deficit pass the replay checks. This is a sound observed qualifying result, not driver-free car pace. Different session phases, track evolution and wet sessions remain context.

Observed opening/latest medians and robust fitted trend are distinct legitimate descriptions. The UI sorts chronological qualifying data, while the standalone Python `compute_development_progression()` depends on supplied order. Its optional circuit terms have no rank/conditioning check; a circuit mix correlated with round can absorb or imitate improvement.

**Recommended:** deterministic chronological sorting inside every model, collinearity/support diagnostics and leave-event-out trend sensitivity. Keep “relative qualifying progress,” not causal upgrade gains. FIA component counts should never supply a weighted performance or downforce gain without independent evidence.

### Reliability and results conversion

Official statuses and points remain defensible observed data. Unlinked incident notes are disabled. Generic retirements remain unknown instead of being guessed as mechanical or accidents. Missing points stay missing.

**Recommended:** show unknown-cause coverage next to mechanical/incident rates and distinguish starts, classified finishes, retirements and DNS denominators. Points per start and finishing positions are outcomes influenced by strategy, incidents and driver execution, not independent car-performance measurements.

### UI precision and telemetry reconstruction

Existing UI logic tests pass, including sort/default/summary behavior; this is not a fresh visual-browser audit of every responsive view. Some context values still display one decimal and the power proxy zero decimals. Additional display digits do not improve source precision.

The existing held-out reconstruction benchmark reports mean error 1.709 km/h but worst error 59.246 km/h across 1,686 samples. Reconstructed display traces must remain separate from performance scoring, and large uncertainty must remain visible. This audit did not feed enhanced browser traces into the scoring pipeline.

## Implementation order

1. Supported/provisional braking separation and visit-type separation in pits.
2. Stable-condition tyre eligibility, retaining all excluded runs as pace-change evidence.
3. Fixed-window repeat tests, native spike screening and progressive candidate retrieval.
4. Common-cohort versus inferred-zone acceleration/season comparisons, with residual and sensitivity evidence.
5. Race-model conditioning/leave-stint-out diagnostics and development ordering/conditioning safeguards.

No team should be moved up or down to match reputation. These changes should improve observational validity and communicate uncertainty; they cannot manufacture the missing private telemetry needed to identify true brake pressure, drag, downforce, fuel load or tyre wear.

## Implementation and final replay

The original findings above are retained as the pre-fix audit. The implementation is documented in `docs/performance-metric-audit.md` under “Cross-GP retest fixes”.

Final replay: 14 events, 747 candidate qualifying laps, 230,230 native samples, no request/replay failures, and no arithmetic failures in baseline or fixed-frame alternate-lap checks. 135 automated regressions pass, including seven new observational-validity checks and fixed-straight-window repeatability. The dashboard build passes. Real-output browser aggregation is measured in tens of milliseconds in this matrix; this is not an end-to-end network-latency guarantee or visual-browser audit.

2026 Italy retains all 11 constructors. The final stricter 2026 Japan replay retains six for complete spatial attribution, versus five in the original audit; native peak evidence remains available for all 11. Four constructors fail repeated-speed/quality screening and Audi fails sector-distance registration. An intermediate relaxed diagnostic retained ten; that is not the final published eligibility result.

Unsupported measurements, unknown pit-visit types, wet/transition tyre trends and sparse common cohorts remain explicit limitations. Fixed-frame alternate laps can be unavailable where a baseline window's eligibility is not met; windows are not silently shifted or shortened to manufacture support. These limits are not fixed by guessing values, adding model weights or interpolating more points.
