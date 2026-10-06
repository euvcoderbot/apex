# Corner coverage and driver views — 6 October 2026

## Findings

The previous detector required a noticeable speed dip and excluded near-flat-out
turns. It was a braking/apex detector, not a complete circuit corner inventory.
This omitted Sepang T5–T6 and turns at every circuit in the eight-event replay.
Circuit identity is used rather than the event label: the 2026 Bahrain-labelled
session carries Sepang circuit key 12.

| Native telemetry replay | Old zones | Circuit markers retained |
| --- | ---: | ---: |
| 2026 Sepang | 8 | 15 |
| 2026 Baku | 9 | 20 |
| 2025 Shanghai | 8 | 16 |
| 2025 Suzuka | 6 | 18 |
| 2025 Silverstone | 7 | 18 |
| 2025 Monza | 6 | 11 |
| 2025 Monaco | 10 | 19 |
| 2021 Portimão | 7 | 15 |

The replay checks found no overlapping corner windows or full-lap partition /
percentage denominator errors. This is an eight-event audit, not a claim that
every historic session has valid geometry or complete telemetry.

## Correction

- Qualifying and race cornering use circuit markers, including flat-out bends.
  Windows extend at most 130 m before and 100 m after each marker, clipped at
  neighbouring marker midpoints. These are approximate analysis windows, not
  surveyed corner boundaries or a measurement of downforce.
- Bands use field-median minimum speed within 25 m of the marker: low ≤120,
  medium ≤200, high >200 km/h. One classification applies to the whole cohort.
  The fastest-lap-only Sepang frontend replay classifies T5 and T6 as high-speed.
- A short internal telemetry gap need not invalidate traversal time if both
  boundary timestamps are supported. Boundary interpolation still requires
  brackets no larger than 1.0 s; full-lap continuity and timing checks remain.
  The longest boundary bracket is disclosed; wider brackets make close ranks
  provisional and do not create additional native observations.
  This does not relax same-speed braking's native gap checks.
- Missing corners / incomplete bands remain unscored rather than becoming zero.
  Table labels are the union of supported turns, not the intersection that can
  hide a turn simply because one driver lacks it.
- Native corner results are stored separately from straight/braking batches.
  Switching categories cannot overwrite their source laps or calculations.

## Views

Cornering, straight-line and braking have Teams / Drivers controls. Qualifying
driver views use each driver's own fastest eligible Q1/Q2/Q3 lap; team views use
the quicker driver. Invalid fastest telemetry stays unavailable, not replaced
by a slower lap. Cornering contains Qualifying cornering / Race cornering tabs,
both with all / low / medium / high options.

Race cornering remains matched green-lap observations, not an all-lap raw
average: same race lap and compound, tyre age within two laps, and a finish-line
traffic screen. This screen does not guarantee full-lap clean air.

The browser implements native corner correction against the existing API.
Python adds complete-marker support, scalable driver cohorts and independent
race driver speed-trap rows. Those API additions require the separate Vercel
backend to deploy; pushing source is not confirmation of that deployment.

## Reproduction

Run `node --test scripts/test-ui.mjs scripts/test-corner-geometry.mjs`,
`python scripts/test-performance.py`, `python scripts/test-server-performance.py`
and `python scripts/audit-corner-coverage.py`. The native replay test uses the
optional saved audit fixture outside the repository when present; pure
geometry and cohort tests do not require that fixture.
