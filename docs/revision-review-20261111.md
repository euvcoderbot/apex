# Prepared-data review, 2026-11-11

Current backend fd69bbc4c372beb2d448 differs from the preparation backend 277639bebfb0613957d0 (source
ee687c9caceb6bed2c0b and measurement 267fe2622a3941ad629a are unchanged) in:

- `car_physics.py`: the straight-line total (`track_straights`, "Time on the straights" in Car performance). A car whose
  fastest lap missed one designated straight (a telemetry gap on that stretch, or a tow beyond the 10% outlier limit) was
  dropped from the whole GP, so a team could be absent at a circuit for a gap on one short straight: 2026 lost a team or a
  driver this way at China, Japan, Austria, Hungary, Netherlands, Singapore and the United States, although its other
  straights were measured. Now every car is compared over the straights all measured cars share, as long as those keep at
  least 60% of the straight distance (`STRAIGHT_COMMON_SHARE`); only below that does the old rule apply. A total built on
  the shared set carries `common_straights: true`, and each straight says whether it was `compared`.
  `straight_totals()` is the new, tested function (`scripts/test-car-physics.py`, `StraightCoverageTests`).

Corners, braking, energy, top speed, lap times and every other model are unchanged; with full coverage the straight total is
identical to before.

Migration:

- Every 2026 speed-domain batch (`/api/performance/trace-batch … measures=speed`, team and driver) is re-exported at the
  current revision from local compute (same addresses, new capture times).
- Race performance captures are re-stamped by `refresh-retirement-classifications.py` (retirement metadata only; it asserts
  every observation is unchanged).
- `lib/snapshot-policy.json` accepts 277639b (and what it accepted) under fd69bbc, so every other retained observation keeps
  its original provenance.
