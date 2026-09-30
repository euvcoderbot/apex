# Qualifying braking correction — 30 September 2026

Braking remains qualifying-only. Race laps do not enter this analysis.

## Confirmed audit findings

China, Monza and Monaco 2025 and Baku 2026 returned mathematically consistent mean deceleration, distance-based deceleration and mass-normalized kinetic-energy-loss rates. These are not brake-pressure or brake-hardware measurements.

A synthetic, well-sampled 250–200 km/h stop at 5 g took 0.283 seconds and was excluded by the old 0.300-second cutoff; a 4 g stop at 0.354 seconds passed. China also contained crossings with only one native interior sample. Repeated Red Bull zone durations varied by roughly 0.055–0.098 seconds. Existing tests did not cover the duration-selection bias.

## Corrections

- Positive duration, native coverage, maximum sample gap and physical deceleration checks replace the duration floor. This removes the stronger-braking selection bias.
- Shared speed-range selection prioritizes cohort size, then speed span, then repeated support.
- Repeats match the selected driver's compound and qualifying phase. Unknown legacy metadata cannot establish compound matching; rerun Analyse with the updated dashboard.
- The approach metric uses one selected real qualifying lap and original timestamps, never a median composite of different lap approaches or official-lap rescaling.
- Boundary speeds are screened against the field median: entry tolerance is max(5 km/h, 2%), exit tolerance max(5 km/h, 3%). At least three eligible teams must remain. These are declared screening tolerances, not physical constants.
- Approach cohorts and coverage are scored separately from same-speed slowing cohorts. A rejected approach may still contribute valid slowing evidence.
- Slowing diagnostics disclose native interior samples, endpoint sampling bracket widths and repeated-lap duration range. Supported evidence requires at least two native interior observations in every contributing lap, endpoint bracket sum no greater than the measured duration, and repeated range no greater than max(0.050 seconds, 10% of duration). Other valid measurements remain provisional rather than silently disappearing.
- No weighted mixture of correlated g, distance, power and time is used. Approach time is the main view; slowing is separately selectable.

## Limits

Endpoint bracket widths are sampling-resolution diagnostics, not confidence intervals. Repeat range includes genuine driver/tyre/track variation as well as measurement error. GPS/sector distance registration remains approximate. The approach is only the observed straight part before reference turn-in, not full-corner or whole-lap performance. Driver and car cannot be separated, and three displayed decimals do not imply millisecond accuracy. Narrow rankings must be treated as provisional.
