# Car Performance review

## Decision

Use elapsed time or speed in a defined part of a lap as the primary observable. Keep qualifying, race and launch execution separate. A high finish, high terminal speed, quick pit service and low tyre-age slope answer different questions. Report a change of leader under reasonable aggregation alongside the ranking. A season of qualifying traces supports comparisons that a single standing start cannot.

## Inputs and capabilities

| Evidence | Where it enters | What survives processing | Limit |
|---|---|---|---|
| Car packets | F1 timing via FastF1, or OpenF1 car_data | Timestamp, integer speed in km/h, throttle, binary brake, gear, RPM and DRS code where present | OpenF1 advertises 3.7 Hz. Packet spacing varies. Channel defaults in session_loader can turn absent channels into zero, so a launch needs a known native speed series. |
| Position stream | Separate timestamped X/Y track coordinates | session_loader matches nearest within 0.3 s, interpolates across gaps up to 0.6 s and records provenance | Projected path distance and alignment are estimates. More points on a 5 m grid do not increase independent sample size. |
| Lap timing | Session timing, sector splits, traps and official durations | Selection with nearest bracket at each lap edge. session_loader interpolates timing edges only across gaps up to 1.5 s. Local physics has tighter gates. | A timing line, first telemetry sample, race-control status and lights-out are four different events. Mini-sector flags are categorical timing evidence. |
| Conditions and stints | Timing-app compound, age, stop, weather and track-status feeds | Clean laps, uninterrupted stints, field lap effects, circuit and session identity | Ambient readings cover an area. Actual tyre temperature, mass, fuel burn, slipstream and deployment instructions are latent. DRS code semantics depend on season. |
| Classification and pits | Official results, source-matched reported reasons, service and lane feeds | Starts, finishes, completed laps, crew stop time where supplied and lane duration | Contact, failure and withdrawal can produce the same result. Lane duration alone cannot identify counterfactual race time lost. |
| Starts | Whole race car packets, race status, track status, driver entry and grid classification | Per-car movement bracket, integrated distance and speed at supported distances. SC release observations use status-clock windows. | Lights-out, clutch torque, wheel speeds, steering angle and actual starting coordinates are unverified. Seconds from a grid slot to Turn 1 would mix different distances. |
| Historical coverage | Shipped annual pace summaries from 2018 through 2026 | Race rounds in year order: 16, 19, 16, 20, 21, 22, 22, 22, 20 in this checkout | Coverage is per product. The telemetry index here has 565 qualifying, sprint qualifying and FP1 driver packs. The validation folder has 15 qualifying files for 2025 and 19 for 2026. Only one locally cached Race directory had car_data. OpenF1 publishes history from 2023. |

Sources: [FastF1 timing reference](https://github.com/theOehrly/Fast-F1/blob/main/docs/data_reference/time_explanation.rst), [FastF1 telemetry calculation guidance](https://github.com/theOehrly/Fast-F1/blob/main/docs/data_reference/howto_accurate_calculations.rst), [OpenF1 coverage and cadence](https://openf1.org/).

## Metric decisions and alternatives

| Metric | Current production path | Decision and alternative considered |
|---|---|---|
| Qualifying and race pace | performance.py fits screened race laps with compound/age, race-lap context and traffic diagnostics. sharedPace ranks eligible entrants on common GPs and bootstraps whole weekends, rebasing every draw. | Keep percentages for season and show seconds at one circuit. Raw fastest qualifying lap includes driver and session phase. Adjusted qualifying substitutes a marked raw result when evolution has insufficient support. A common-event model limits circuit bias but can lose many rounds with incomplete fields. An opponent-overlap model would require connected competition and checks on bridging teams. |
| Cornering and phase splits | car_physics projects speed to a reference path, times shared envelopes, classifies them by field corner speed and breaks them into braking, mid-corner and exit phases. Race corners have separate matched/age-adjusted paths. | Keep integral of ds/v on supported segments with seconds at one GP or percentage of lap/segment across GPs. A single minimum speed cannot describe entry and exit. Fix a missing segment time becoming 0% after division by field lap time. Alignment, mixed lines and compound remain limitations. Segment boundary shifts are sensitivity scenarios. |
| Straight line and energy | Actual track-straight timing, speed-band acceleration, native peak/trap and full-throttle speed fade describe different observations. | Preserve separate views. End speed depends on distance, entry speed, setup, tow, DRS and gears. A full-throttle speed loss cannot identify electrical deployment. Use acceleration curves over supported speed intervals only. |
| Corner exit | Smoothed speed derivative over accepted packets, with throttle, lift, braking and speed-since-apex gates. Local curve sampled over a standardized speed range. | Name the observable exit acceleration. Tyres, driver and power all affect it. Removing genuine poor exits to force a stronger teammate correlation would bias the sample. Historical teammate agreement after adjusting for lap time was weak. |
| Braking | Estimated onset between off/on packets, average deceleration from squared speed change divided by twice projected distance, speed-normalized field comparison. | Keep sustained slowing and matched zones. Later onset or the highest single derivative amplifies technique and sampling error. The existing 2026 low-confidence override is warranted. Avoid a claim about brake pressure, hardware or peak braking force. |
| Pit stops | Timed stationary service or pit-lane visit. Within-GP comparison available for lane times. | Median typical service is defensible. Separate penalties/abnormal visits where evidence permits. A visit-weighted mean answers operational cost including long stops. Show the two measures separately. Timing under SC/VSC does not directly identify time lost relative to cars on track. |
| Tyres | Robust stint/phase estimates, exact grades where mapped, screened conditions and optional fuel scenarios. Driver balancing within GP limits long-stint domination. | Keep observed and assumed-fuel slopes separate. Validate a state-space replacement on future held-out stints before estimating latent wear. Block validation by stint/GP. Per-lap random splits would leak stint conditions. Warm-up and late falloff need sufficient observed ages. [State-space model and assumptions](https://arxiv.org/abs/2512.00640). |
| Development | The rendered JS trend uses evolution-adjusted qualifying gaps, opening/closing medians, Huber fit by round and leave-one-event slope ranges. A separate Python model can include circuit covariates when supported. | Describe relative qualifying progress. A fitted time slope cannot resolve chronological upgrades from the sequence of circuits. A multivariable adjustment is experimental until past-to-future validation improves error against the simple model. |
| Finishes and retirements | performance.py counts starts, completed laps, incidents and classified causes. Wikipedia-derived descriptions carry a source and verified=false. | Use per-start risk for season outcomes. Distance exposure answers the separate hazard question and preferentially excludes early failures. Puncture, vibration, kerb strike, loss of drive and power loss alone cannot identify a failed subsystem. Remove those keyword assignments, preserving the account and provenance. |
| Team profile and peak-speed evidence | A compact rank across the qualifying and race summaries and speed-domain columns. | Exact equal values share competition rank. A best-ranked column among several measurements is descriptive and subject to selection bias. Show rank together with the measured value. |
| Starts and restarts | New offline start-execution-v1 series and dedicated measurement tab | Inspect observed driver/car execution at the same distance from each car’s stationary position. Use independent native speed packets. Show SC-to-green speeds separately, with no combined ranking. Limit comparisons to one event at a time. |

## Start estimator and uncertainty

Select the first Started status to locate a broad race-start window. Check track status, a classified positive grid slot, a stationary baseline of at least one second and the transition to positive native speed. Session clock is only a window locator. Native packet UTC defines each time difference. A driver who remains stationary past the observed window is unavailable. Wet conditions, traffic and poor starts remain part of observed execution. A green flag does not guarantee dry or clear running.

Use the midpoint of the last stationary and first moving packet as time zero. Convert speed by dividing km/h by 3.6. Integrate trapezoids in metres. For a mark inside a packet interval assume linear speed change in time. With acceleration a, distance x and starting speed u, crossing speed is sqrt(u²+2ax) and elapsed time is 2x/(u+v). A brake application, nonfinite speed, reversed/duplicate time or gap over 0.6 s terminates measurement. Midpoint origin introduces uncertainty of up to half its bracket before other speed/integration errors. The maximum packet gap describes resolution, not a confidence interval. Wheelspin, slipping clutch and aerodynamic forces are unidentifiable. Distances beyond the observed straight launch segment require circuit-specific geometry review.

The Monaco pilot yields 21 starts reaching 5 m, 20 reaching 10 m, 20 reaching 15 m and 15 reaching 20 m. No 25 m or longer comparison survives the gap gate. Each table cell reports the available drivers. The speed profile uses the same axes across drivers and ends at each driver’s last supported mark. Two SC-to-green transitions yield 33 moving-driver observations with all three readings. These are speeds around the status update, not observed leader reaction times. Pit-lane position and traffic at release are unresolved, making a restart leaderboard unjustified.

## Validation and reproduction

Run `node scripts/audit-performance-sensitivity.mjs` for all retained team speed metrics. The output includes every entrant, measurement count, mean and median order, removal of each entrant’s fastest or slowest GP and 5%-per-tail trim. With fewer than 20 GPs integer trimming removes zero observations. The removal scenarios are influence diagnostics, not recommended exclusions. Retained index revision 95272b8c86a3b0b51eca predates subsequent analyses, so these are reproducible archive results and should not be advertised as current live rankings.

| Retained 2026 metric | Supported GPs | Leader by mean | Leader by median | Drop fastest GP per entrant |
|---|---:|---|---|---|
| Slow corners, % lap | 18 | Ferrari | Ferrari | Ferrari |
| Medium corners, % lap | 16 | Ferrari | Ferrari | Ferrari |
| Fast corners, % lap | 13 | Mercedes | Ferrari | Mercedes |
| Track straights, % lap | 18 | Mercedes | Mercedes | Mercedes |
| 250+ km/h acceleration | 17 | Alpine | Alpine | Alpine |
| Corner-exit acceleration | 12 | Red Bull Racing | Racing Bulls | Racing Bulls |
| Braking | 18 | Red Bull Racing | Ferrari | Ferrari |
| Full-throttle speed loss | 18 | Williams | Williams | Williams |

Run `node scripts/audit-weekend-prediction.mjs`. For each team with at least four measured rounds, predict its held-out observation from its remaining rounds. This tests generalization to another sampled circuit, not a future calendar forecast. Each row is a team-weekend observation. Circuit composition and cross-team correlation prevent treating all observations as independent. The tyre diagnostic uses reported compounds and observed slopes, distinct from the exact-grade headline fit.

| Held-out observable | Team-weekends | MAE using mean | MAE using median |
|---|---:|---:|---:|
| Qualifying pace, percentage points | 198 | 0.415 | 0.405 |
| Race pace, percentage points | 195 | 0.493 | 0.509 |
| Stationary stop, s | 108 | 1.271 | 0.959 |
| Lane time vs field, s | 108 | 1.270 | 1.008 |
| Observed soft stint slope, s/lap | 108 | 0.1131 | 0.1061 |
| Observed medium stint slope, s/lap | 160 | 0.0594 | 0.0556 |
| Observed hard stint slope, s/lap | 145 | 0.0424 | 0.0425 |

A median does not win every comparison. For mechanical incidence the median predictor gives zero for most teams, so its lower absolute error is a poor basis for estimating risk. Use totals divided by starts with numerator and denominator. Three observed reasons in the archive lose unsupported subsystem attribution: Bahrain Mercedes power loss and Aston Martin vibrations in China and Australia. A changed retirement revision requires reclassification before publication.

Earlier controlled cases include rejected impossible-distance laps at Suzuka, validated T11 alignment in São Paulo and weak braking teammate agreement after removing lap time. Reproduce earlier checks using the recorded-physics and speed-domain regressions. See [physics validation](physics-validation-20261031.md) and [corner trace audit](corner-trace-audit-20261021.md). These checks constrain measurement errors without requiring any particular team to rank first.

## Implementation and release boundaries

Python start extraction runs offline. Reproduce with `python scripts/export-start-execution.py <trusted-fastf1-cache> assets/data/start-execution.json`. Only compact observations load on entering Starts & restarts. The browser calculates medians of displayed runs and the speed-chart sensitivity uses existing per-GP aggregates. Raw packets stay separate. The release carries a dedicated start schema, independent browser and retirement revisions. The audited retirement-only change preserves the pace and telemetry backend identity. Never approve a mismatched retirement revision solely because lap timing matches.

Production files changed include performance.py, speed-domain.js, car-performance.js, analysis-core.js, dashboard-ui.js, url-state.js, the speed view, ranked bar component, React island registry, StartsView and LaunchProfile. Regression coverage includes analytic constant acceleration with irregular sampling, absent/duplicate data, interrupted and slow starts, unsupported segment shares, ambiguous retirement causes and populated phone/desktop views. Known limits include single-race launch coverage, lack of official lights-out synchronization, no wet/dry launch strata and no defensible season launch or rolling-restart ranking. A multi-circuit launch validation and prospective season holdout remain research work.

## Before and after matching circuits

The season telemetry table now admits entrants observed in at least half the metric-bearing weekends, takes their intersection, and requires that intersection to cover at least half the supported weekends. Each shared weekend receives equal weight. An insufficient intersection leaves the season comparison unranked. Per-event detail stays available. This complete-case comparison can bias the calendar toward well-covered circuits and may produce sparse fields. It is an estimate for the named shared weekends.

On the archived inputs the braking leader changes from Red Bull Racing to Ferrari when comparing the same 15 of 18 weekends. Corner exit changes from Red Bull Racing to Racing Bulls on 8 of 12. Slow corners still favour Ferrari on 12 of 18, medium corners Ferrari on 13 of 16, and fast corners Mercedes on 11 of 13. Mercedes remains first on actual track-straight lap share on 11 of 18. The full before/after orders and event counts are reproducible in the sensitivity script. Weak braking and exit measures are excluded from a team's strongest attribute when the season/metric confidence flag is low.

## Priority and remaining experiments

1. Ship the missing-value, tie, metric-description and matched-calendar fixes with the comparisons above. Reclassify affected race annotations before publishing results that rely on the new counts.
2. Keep launch execution as a circuit-specific pilot. Inspect the actual status transitions, grid classification, packet gaps and first-turn geometry for further circuits before expanding it into a season comparison. Capture wet starts, pit-lane starts and red-flag standing restarts separately.
3. Evaluate opponent-overlap partial pooling when complete-case intersection discards too many tracks. Test predictive calibration across circuits and independent seasons. A more complex model should outperform the held-out baseline before replacing it.

A separate offline migration rehearsal used temporary copies of 209 race snapshots from the scheduler's prerendered and local-capture indexes. Of 646 retained retirement records, 20 chassis and 11 power-unit attributions moved to unknown. These are record counts across overlapping stores. Every non-retirement observation compared equal before and after. The rehearsal left the scheduler and published indexes untouched.

### Circuit holdout

For each supported shared GP, train on the remaining shared rounds and predict the order of every measured pair at the omitted round. Exclude actual ties and give a predicted tie half credit. Average accuracy within each GP and give every GP equal weight. This measures predictability of the observable under changes of circuit. It does not validate a latent physical property.

| Archived 2026 measure | Holdout pair accuracy, mean / median | Teams that lead after omitting one shared GP |
|---|---|---|
| Fast corners, % lap | 83% / 84% | Mercedes, Ferrari, McLaren |
| 250+ km/h acceleration | 68% / 67% | Alpine |
| Corner exit | 53% / 58% | Racing Bulls, Red Bull Racing, Audi |
| Braking | 62% / 62% | Ferrari, Racing Bulls |

The exit ranking in particular has little predictive power on another circuit. Consistently locating where a team loses time in one qualifying trace is a different claim from predicting the next race. The mean/median warning in the chart tests the selected sample. It is not a substitute for the independent holdout diagnostic.

The scheduler's prepared local index contains 108, 125, 97, 131, 132, 126, 140, 143 and 125 session routes for 2018 through 2026 respectively. Performance routes over those years number 39, 42, 34, 44, 44, 44, 48, 48 and 42. These are index entries, not a channel-by-channel completeness guarantee or full-race packet coverage.

### Mexico City regression on the re-exported telemetry

The separate 42-batch local replay at backend c18f75bc4ecbc34e05f2 reproduces the Mexico City correction. Mercedes moves from a 1.286 index and +0.614 s versus the field median to 0.992 and −0.011 s. Russell separately moves from 1.277 and +0.631 s to 0.979 and −0.031 s. The baseline is per capture, so compare each signed gap in context. The prior batch ranked Mercedes 11th of 11 over nine matched GPs. The fresh batch has only five shared of thirteen supported GPs and the original complete-field rule leaves the season leaderboard unavailable. This is a result of the evidence rule applied to the re-export, not a claim about the current live dataset.


The coverage sensitivity output also tries eligibility and shared-coverage thresholds of 33%, 50%, 67% and 100%. In the 2026 archive the first three thresholds select the same entrants for fast corners, 250+ km/h, exit acceleration and braking. At 100%, fast corners retain only seven entrants and the leader changes from Mercedes to Ferrari. Braking retains eight and the leader changes from Ferrari to Red Bull Racing. These are calendar-and-field sensitivity checks, not grounds to choose the cutoff based on the desired result.

### Conditions sensitivity

When every selected qualifying lap must carry a known slick label, one archived weekend drops from each of the four featured speed cohorts. The fast-corner, 250+ km/h and braking leaders stay the same. Exit acceleration moves from Racing Bulls on eight shared GPs to Red Bull Racing on seven. Slick labels are a condition proxy. A wet/dry causal adjustment would also need aligned rainfall, track state, compound age and phase.

The race-pace holdout uses 185 team-weekends after restricting to non-provisional clear-air observations, compared with 195 in the available-data version. Both give Mercedes the best aggregate and mean-predictor error near 0.493 percentage points. The restricted sample is a different population, so the two errors cannot be used to measure the causal effect of traffic. The comparable archive has too few supported condition-adjusted qualifying observations for the held-out comparison.

The straights-versus-corners scatter now builds a single cohort before averaging. Each point needs a straight measurement and all three corner bands from each included GP. In the three-GP UI fixture, two GPs have a sufficient paired field. Summing the independently ranked bands could combine different circuits on the two axes. The chart names the shared GP count and describes observed deficits without attributing the axes to drag or downforce.


## Expanded qualifying samples and matched rivals

The native speed-batch path can now request two distinct laps per entrant. Team estimates use the best eligible dry lap from each available teammate. Driver estimates can use a second eligible lap of the same compound within 1% of the driver's quickest selected lap. A plan needs at least three entrants with two candidates and must retain the expected field. Lap identities are deduplicated and source eligibility filters remain active. Season overlap is counted in GPs because laps from one session share conditions. Qualifying pace still uses its official headline lap. The server records how many laps and which drivers survived validation and projection. An unavailable extra lap cannot erase another valid lap from that entrant.

Expanded batches use distinct cache keys. Local compute and preparation use the same selector as the browser. Published views continue to serve compatible single-lap captures when expanded results are absent. A season ranking compares one sampling policy at a time, takes the policy with more supported GPs, and favours the expanded cohort on a tie. Other observations are still available by GP. Field exclusions, tyre condition, aero state and driver execution remain sources of uncertainty.

The matrix below comes from running `python scripts/audit-repeat-telemetry.py <year>` on native qualifying traces. This controlled replay compares one lap per team with one per available teammate. It isolates the effect of more traces on the existing physics. The archived trace corpus lacks full tyre/condition metadata, so these numbers describe replay coverage and do not predict exact published coverage.

| Measurement | 2025 usable team-GPs before → after | 2026 usable team-GPs before → after |
|---|---:|---:|
| Exit acceleration | 35 → 54 | 100 → 177 |
| 160–250 km/h acceleration | 115 → 138 | 172 → 172 |
| 250+ km/h acceleration | 140 → 140 | 184 → 186 |
| Track straights | 150 → 150 | 193 → 196 |
| Braking | 146 → 149 | 194 → 197 |
| Slow corners | 149 → 150 | 194 → 193 |
| Medium corners | 130 → 130 | 173 → 175 |
| Fast corners | 89 → 90 | 87 → 98 |

In 2026, usable corner-exit fields expanded from 10 to 17 weekends. In 2025, they expanded from four to six. Some added observations expose disagreement in the underlying segment evidence. Coverage is therefore allowed to decrease for an individual metric.

Pace and telemetry season rankings now try matched-rival scoring if a complete field covers fewer than half the supported GPs. Every pair must have direct overlap on at least half of those GPs. Compute the median telemetry gap on the shared weekends for that pair, then average the pair gaps over the field, including a zero for the entrant itself. This keeps the resulting gaps on the original measurement scale. For pace, each pair's differences are taken between log lap-time ratios and summarized with the selected statistic. The scores are rebased to the best team and shown as percentages. Only the complete-field pace model shows a bootstrap interval. The matched-rival score uses sparse but comparable observations and does not assert a common ranking at every circuit. The chart displays the number of GPs per pair and continues to label weak signals. The straights-versus-corners scatter can use the same fallback, with identical evidence on both axes.

On the 42-batch c18f75b replay, all 11 teams had 8–13 common weekends per rival in exit acceleration. The matched-rival median led with Mercedes and predicted 60.5% of measured pair orders in a leave-one-GP-out replay. The five fully shared GPs yielded 50.6%. The percentages describe the ability to predict pair order at an omitted circuit and are not a confidence interval for the season order.

Additional evidence must match the quantity. Race pace continues to use eligible race laps matched by context. Tyre trend still fits uninterrupted stints and pit rankings use timed visits with stationary and lane durations separated. Development uses chronological rounds, reliability uses starts, and the Starts & restarts pilot needs additional native race-start coverage. Qualifying samples do not add information to those categories.
