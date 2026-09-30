# Car performance audit — 30 September 2026

## Changes from this audit

- Tyre evidence now has linked team, driver, Grand Prix and individual-run selectors. The previous plot was a single longest stint, not an Aston-only season analysis. Rankings still use all eligible evidence; changing the evidence plot does not change those rankings.
- Acceleration no longer intersects the entrants across every zone. A robust additive car/physical-zone fit connects partially overlapping observations. Each zone still requires three comparable cars. Disconnected groups cannot share a ranking baseline, and cumulative loss is unavailable where zone coverage differs.
- Season event-effect fits also reject disconnected comparison groups instead of inventing a common zero. Shared observations bridge unequal coverage, but this is an estimated effect, not a directly observed complete lap.
- Corner-band average speed is distance divided by traversal time, not an unweighted mean of differently sized corners. Alignment corridor indexing uses the actual distance grid rather than assuming exactly five metres per point.
- Low-speed acceleration applies the stated 70% throttle threshold consistently in both extraction paths.
- Race-pace sensitivity reuses the central 2-second traffic fit instead of calculating it twice.
- Reliability no longer overrides supplied classification statuses with unlinked incident notes. Generic retirements remain unknown. Missing championship points remain missing in the chart, not zero.
- Development progression uses chronological qualifying observations when calculating opening/latest medians and the trend.

## What each category can actually establish

| Category | Meaning and important limits |
| --- | --- |
| Qualifying | Fastest eligible lap across Q1/Q2/Q3 per team. Driver execution, session evolution and tyre choice remain in the result. Phase/evolution adjustment is a diagnostic, not a replacement for the official best lap. |
| Race pace | Dry, green-flag, traffic-screened laps with shared race-lap, compound and age effects; fastest supported teammate. Race-lap effects absorb common fuel burn and track evolution, rather than supplying measured fuel correction. Traffic sensitivity and sample support matter. It is not a race finishing-order predictor. |
| Corners | Same physical windows, field-defined speed classes and qualifying-lap timing attribution. Apex speed alone cannot measure corner performance or isolate downforce. |
| Straights | Traversal time includes exit speed and energy deployment. Speed-band acceleration is separate: a car can accelerate quickly through one range without covering the whole straight fastest. Different 2026 battery strategies are not identifiable from speed alone. |
| Braking | Qualifying observations through matched speed reductions and shared approach windows. Public brake state is not pressure. Deceleration, distance and traversal time describe different aspects and need not rank cars identically. No component should be called isolated brake hardware performance. |
| Tyre age | Robust within-run lap-time change with increasing tyre age, by exact compound nomination. Equal driver/event weighting avoids letting a single long stint dominate. Fuel correction is assumed, not measured. Traffic, management, temperature and track evolution remain confounders; a low slope is not proof of superior tyre wear. |
| Pits | Stationary service time and pit-lane duration are different supplied channels. Exact visits, distribution summaries and raw versus GP-relative views remain separate. Missing stationary measurements are not reconstructed from lane time. |
| Development | Relative qualifying progression, not a causal estimate of upgrade gains. Driver changes, circuits and weather can explain apparent improvement. |
| Reliability/results | Official classifications and points. Unknown causes stay unknown; cause-labelled mechanical counts may undercount failures. Finishing results do not isolate car pace. |

## Follow-up improvements

- Tyre-age results offer explicit 0.040/0.060/0.080 s-per-race-lap fuel assumptions. These are sensitivity scenarios, not measured or calibrated fuel effects; raw pace remains available. Chart dots, fits, early/late slopes and summaries use the same selected assumption.
- Runs with at least twelve usable laps have a consecutive-block deletion sensitivity range. Successive chunks are omitted and the robust slope is refitted. This respects adjacent-lap grouping better than independent-lap perturbations, but is deliberately not called a confidence interval. It does not capture traffic or fuel-model bias.
- Qualifying evolution uses only a known dry compound represented in all three phases, with matching advancing drivers. Rainy and unknown-compound laps do not contribute; ineligible team laps do not fall back into the adjustment. Official fastest-lap rankings remain unchanged.
- Race-pace evidence now reports each selected driver's actual race-lap range, compounds, stint count and GP-specific traffic sensitivity. A final-GP bracket no longer appears as a season-wide uncertainty range. API brackets retain more precision before display rounding.

Remaining physical-identification limitations cannot be removed by interpolation or additional weighting: isolated fuel load, aero state, brake pressure, tyre wear and driver targets are not supplied by these feeds. No ranking is forced to agree with team reputation.

## Sources and verification

- [OpenF1 channel definitions](https://openf1.org/docs/) distinguish stationary stop duration from lane duration and document their coverage.
- [Formula 1's braking explanation](https://www.formula1.com/en/latest/article/rob-smedley-explains-how-the-new-aws-braking-performance-graphic-works-and.3A8cnQLZGXFbMjCR2fFBnB) describes the broadcast graphic, which has richer underlying telemetry than the public feed. Interpolation cannot create equivalent new measurements.
- Deterministic regressions exercise partially overlapping acceleration zones, disconnected ranking groups, multi-team tyre plot selection, tyre aggregation, pit summaries, qualifying selection, braking support, and classification handling.

This is a code/methodology audit with regression checks, not a claim that every season's underlying feed has been independently verified. Additional credible improvements require uncertainty estimates and controlled sensitivity checks rather than forcing rankings to match expectations about the leading teams.

## Cross-GP retest fixes — 30 September 2026

- Braking defaults to supported native observations. Provisional samples remain available through an explicitly diagnostic toggle. Common observed coverage is the default; the overlapping-zone/event model remains a sensitivity view, not a measurement of missing values.
- Acceleration uses a complete observed car-by-zone cohort chosen to retain the most observations. All measured crossings, locations, aero states and native timing intervals remain inspectable, even when a crossing does not enter that cohort. Low bands still include traction/turning and do not isolate engine power.
- Season telemetry offers common observed coverage versus the existing inferred coverage-adjusted model. Each common ranking discloses its actual teams and events. Collected table sample counts must not be confused with that ranking subset. Different metrics can have different subsets; they cannot automatically be summed after independent rebasing.
- Qualifying candidate retrieval expands from three to six real laps per team within the existing 1% representativeness limit. Reference selection searches a bounded set of other constructors when an initial reference rejects most of the field, retaining the broadest validated registration. Checks are not waived to include more teams.
- Native speed screening rejects physically impossible maxima and isolated uncorroborated peaks. Ranked qualifying peaks use the original speed samples, not the distance-grid maximum. Separate native evidence survives missing GPS without supplying spatial attribution or entering the GPS-qualified ranking.
- Repeated-speed shelves are not rejected solely because other cars change speed: corroborating brake-state or position-channel evidence is required. This matters when 2026 deployment strategies differ. Native position is noisy, so this remains an observable screening rule, not proof that every accepted sample is correct.
- Tyre pace-change fits retain all diagnostic runs. The default condition screen excludes wet/transition context and rapid common-field improvement below −0.150 s per race lap, using at least three drivers with overlapping runs. It does not subtract rivals' slopes from the driver's fit or clip negative trends. Warm-up overlap is flagged, not silently declared physical wear. Passing these screens does not identify tyre wear, fuel load, management or temperature effects.
- Pit summaries default to confirmed service evidence from supplied stationary timing, new tyre stints, or FastF1 stint plus tyre-age reset. Untimed visits without service evidence remain unknown, not automatically classified as pass-throughs. All lane visits remain available diagnostically and in exact rows. Stationary timing is never inferred from lane duration. A schema-version query bypasses old CDN responses after this source update.
- Race pace reports practical driver-contrast noise gain, per-stint residuals and deletion sensitivity for the three largest sampled stints. High amplification is provisional. Traffic scenarios also disclose contrasts on a fixed common driver cohort; independent model rebasing is not presented as a confidence interval.
- Development calculation sorts events internally, rejects collinear circuit adjustment, and reports leave-one-event-out trend sensitivity. Neither relative qualifying progress nor FIA component counts establish causal upgrade gains.
- Unknown retirement counts are visible beside mechanical rates. Finish/start rates use supplied Finished/lapped statuses, exclude DNS/withdrawn/non-qualified entries from starts, and are not claims about classified-distance reliability.
- Hiding descriptions no longer hides entire interactive evidence accordions. Quality-mode status remains visible, and long control groups stay within the card width.

Repeatability testing uses an internal fixed event frame: original reference, corner bands/windows, braking approach windows and speed endpoints, low-speed crossing anchors, settled straight windows and terminal corridors. Alternate laps that no longer satisfy a frozen window remain unsupported; the test does not silently shorten the window to improve a comparison. Cohort/baseline changes remain explicitly separate from absolute time changes.

The replay covers 14 GPs spanning 2018, 2021, 2025 and 2026, 747 candidate laps and 230,230 native samples. Test evidence is saved outside the dashboard as `metric-audit-fixed-evidence.json`; it is not a performance-result cache. The reusable harness is `scripts/audit-metric-matrix.py`, and `scripts/audit-ui-metrics.mjs` runs those real outputs through the browser aggregation. No expected team ranking is an assertion.
