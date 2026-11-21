# Prepared-data review, 2026-11-11

Current backend 2e4a10782d8503619079 differs from the preparation backend 277639bebfb0613957d0 (source
ee687c9caceb6bed2c0b and measurement 267fe2622a3941ad629a are unchanged) in:

- `car_physics.py`: the straight-line total (`track_straights`, "Time on the straights" in Car performance). A car whose
  fastest lap missed one designated straight (a telemetry gap on that stretch, or a tow beyond the 10% outlier limit) was
  dropped from the whole GP, so a team could be absent at a circuit for a gap on one short straight: 2026 lost a team or a
  driver this way at China, Japan, Austria, Hungary, Netherlands, Singapore and the United States, although its other
  straights were measured. Now every car is compared over the straights all measured cars share, as long as those keep at
  least 60% of the straight distance (`STRAIGHT_COMMON_SHARE`); only below that does the old rule apply. A total built on
  the shared set carries `common_straights: true`, and each straight says whether it was `compared`.
  `straight_totals()` is the new, tested function (`scripts/test-car-physics.py`, `StraightCoverageTests`).

- `car_physics.py`, the same rule for the cornering bands (low, medium and high speed): `band_totals()` compares every car
  over the band's corners all measured cars share while they keep at least 60% of the band's field time
  (`CORNER_COMMON_SHARE`); a total built that way carries `common_corners: true`. Gaps across the 2026 speed batches fell
  from 22 GP-band entries to 7 (bands of two or three corners where the shared corners hold less than 60%).
  Tested in `CornerCoverageTests`.

Braking, energy, traction, top speed, lap times and every other model are unchanged; with full coverage the straight and
band totals are identical to before. fd69bbc4c372beb2d448 was an interim revision (straights only), never published.

Migration:

- Every 2026 speed-domain batch (`/api/performance/trace-batch … measures=speed`, team and driver) is re-exported at the
  current revision from local compute (same addresses, new capture times).
- Race performance captures are re-stamped by `refresh-retirement-classifications.py` (retirement metadata only; it asserts
  every observation is unchanged).
- `lib/snapshot-policy.json` accepts fd69bbc, 277639b (and what it accepted) under 2e4a107, so every other retained observation keeps
  its original provenance.
