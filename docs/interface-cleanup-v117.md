# Interface cleanup — session and car performance

## Kept as primary controls

| Category | Useful choices |
| --- | --- |
| Session analysis | Session, drivers/laps, reference and visibility, zoom/full-page view, corner/straight selection, corner numbers and speed annotations |
| Pace | Best lap or track-evolution estimate; mean or median GP summary |
| Cornering | Teams/drivers, qualifying/race, all/low/medium/high-speed corners |
| Straight line | Teams/drivers, qualifying/race source, seconds/percent units, acceleration speed bands |
| Braking | Teams/drivers, same-speed slowing or time through zone |
| Pit stops | Teams/drivers, stationary/lane, raw/GP-relative lane times; mean, median, quickest, IQR |
| Tyre trend | Own tyre-age trend or matched rivals; teams/drivers, verified compound, observed pace or explicitly assumed fuel correction |
| Development | Opening-to-latest change or fitted trend; each measured GP shown |
| Results | Points, points/start, finish rate, cause-labelled mechanical retirement rate |

## Removed from the interface

Experimental timestamp qualifying mode, previous linear race-pace model, legacy
corner windows, complete-corner-total switch, alternate race-corner age model,
strict acceleration cohort switch, straight entry-matching switch, diagnostic
coverage switch, repeated mean/median selectors, tyre P75/fit/coverage/quality/
lap-weighting and fuel-rate switches, all-lane-visit diagnostic rankings, pit tail
percentiles and trimmed/winsorized headline metrics, rolling trend smoothing,
extra reliability exposure switch, old exit-inclusive straight chart, and session
interpolation/tint toggles. Their unused click handlers were removed as well.

Preferred supported methodology is fixed. No upstream observation, quality gate,
missing-data warning, source identifier or exact pit-visit evidence was deleted.
Mathematical comparison helpers used by regressions and diagnostics remain.
Backend/native caches retain their identities: this is not a data-source reset.

Retained session source notes and 2026 limitations are expandable. Detailed
coverage, exclusions, fit limitations and source tables remain inspectable. Tyre
fuel adjustment is still visibly an assumption (0.060 s per race lap), not a
measured fuel load or isolated physical degradation.

Regression tests enforce removed controls and retained task selectors, and check
the four pit charts against table values and exact source rows. Browser QA covers
every car-performance category plus two-lap session trace selection.
