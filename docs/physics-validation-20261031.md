# Physics and telemetry validation, 31 October 2026

Follows `phase6-correctness-audit.md`, which left the physics models, the batch outputs, `alignment.js` and the network code of
`session_loader.py` unchecked. This covers them. Method and data are reproducible: `scripts/validate-speed-domain.py` (captured
qualifying laps in `data/val`, 22 sessions, 2025 and 2026) then `scripts/validate-speed-domain-partial.py`.

## 1. Does the speed-domain estimator measure the car?

The test that needs no assumption about which team is fast: two drivers share a car, so a car metric should agree between
teammates. But a fast car is fast at everything, so a metric that only restates the lap-time order also shows high agreement. The
number that matters is teammate agreement **after removing each driver's overall lap time** (regress the metric on lap time within
each Grand Prix, standardise the residual, correlate across teammate pairs; 90% interval bootstraps over Grands Prix).

After the lap-distance gate described in section 2 (2026, 13 sessions; 2025 is unchanged by it):

| Metric | 2025 | 2026 | Reading |
|---|---|---|---|
| Straight line | +0.45 [+0.30, +0.61] | +0.64 [+0.57, +0.71] | Car-specific signal |
| Straight, 250 km/h and above | +0.43 [+0.24, +0.59] | +0.64 [+0.55, +0.72] | Car-specific signal |
| Straight, 160 to 250 km/h | +0.25 [+0.02, +0.45] | +0.51 [+0.31, +0.69] | Car-specific signal |
| Energy (speed lost at full throttle) | +0.46 [+0.25, +0.65] | +0.47 [+0.32, +0.61] | Car-specific signal |
| Cornering, low speed | +0.17 [+0.01, +0.34] | +0.41 [+0.28, +0.55] | Real but modest |
| Cornering, medium speed | +0.33 [+0.24, +0.41] | +0.32 [+0.15, +0.47] | Real but modest |
| Cornering, high speed | +0.35 [+0.18, +0.52] | +0.38 [+0.20, +0.58] | Real but modest |
| Traction (corner exit) | -0.14 [-0.39, +0.19] | +0.27 [+0.14, +0.40] | None in 2025; weak in 2026 |
| Braking | +0.42 [+0.34, +0.52] | **+0.14 [+0.02, +0.25]** | Good in 2025; close to noise in 2026 |

Before removing lap time, the 2026 corner metrics read +0.77 to +0.79 (they correlate +0.8 to +0.9 with lap time). Most of that is
the car being fast overall, which is why the lap-time-adjusted figure is the honest one.

**Finding: braking in 2026.** The code labels braking `moderate` (`RELIABILITY` in `car_physics.py`). In 2026 its car-specific
agreement is +0.14, against +0.42 in 2025. The 2026 braking metric is therefore much weaker evidence than its label says. The label
was not changed: where the line between `moderate` and `low` sits is a judgement that was never written down, and it is a user-facing
claim. If it is set at the level traction fails (`low`, below about +0.3), 2026 braking belongs there too.

## 2. Laps whose distance is impossible

The 13 captured 2026 sessions contain **16 laps of 879 whose integrated distance differs from the field's median by more than 3%**,
up to 55% (Shanghai, OCO lap 7: 2,421 m on a 5.4 km circuit) and 40% (Suzuka, OCO lap 11: 8,048 m in 90 s, an average of 321 km/h,
with a minimum speed of 278 km/h). Besides the garbage laps, four Williams laps at Monza (both drivers) read 3 to 4% long, and six laps at Shanghai from different
teams are 3 to 10% off in either direction: a speed or time scale that does not match the rest of the field. 2025 is clean.

The effect was visible: 2026 Suzuka OCO came out **3.36 s faster than the median car in low-speed corners** while 1.5 s off pole.
Nothing in the pipeline stopped it: `prepare()` checks the speed range and that the telemetry covers the official lap time, and
`speed_domain_metrics` checks the flying-lap ratio and the minimum speed, none of which sees an impossible distance.

**Change (needs your decision, see below).** `speed_domain_metrics` now drops a lap whose distance differs from the median of all
laps by more than 3% (`MAX_DISTANCE_ERROR`) and reports the car as excluded with the reason. Evidence it helps, teammate agreement
after lap time, 2026, no gate / 12% / 6% / 3%:

| Metric | none | 12% | 6% | 3% |
|---|---|---|---|---|
| Straight line | +0.56 | +0.56 | +0.65 | +0.64 |
| Straight 250+ | +0.55 | +0.55 | +0.65 | +0.64 |
| Cornering low / medium / high | +0.39 / +0.37 / +0.52 | same | +0.38 / +0.35 / +0.37 | +0.41 / +0.32 / +0.38 |
| Braking | +0.13 | +0.13 | +0.16 | +0.14 |

A 12% gate only removes the garbage laps and changes almost nothing statistically; 6% and 3% also remove the long-reading
laps, and the straight-line metrics, which depend on the speed channel, improve clearly. The high-speed corner figure falls
because 20 more pairs now qualify (62 to 82), not because the same pairs got worse. 3% removes 16 laps in 879 (1.8%) and leaves
three drivers with no usable lap in a session (Monza SAI and ALB, Suzuka OCO).

Not known: why those laps disagree. The Monza ones are both of one team's drivers, which could be a speed-channel calibration
difference, but that was not checked (the Shanghai ones are not a team effect). Straight-line acceleration is read from the
speed channel, which is the likely reason the straight-line agreement improves when they leave.

## 3. Output plausibility

Across 22 sessions, every metric is finite; the straight, braking and traction indices are ratios centred on 1.00 (straight
0.97 to 1.05, braking 0.88 to 1.29, traction 0.85 to 1.46); cornering seconds against the median are centred on 0 with a 5th to 95th
percentile of about ±1.1 s (low), ±0.6 s (medium), ±0.3 s (high). The cornering `index` and `time_vs_median_s` look opposed in
sign (index above 1 with negative seconds) but are consistent: the index is a speed-like ratio, so above 1 is faster.

## 4. `alignment.js` (optional estimated distance alignment)

`scripts/audit-alignment-correction.mjs` runs its invariants on retained real telemetry: 150 laps in 7 sessions, all eligible, the
sector anchors reproduce exactly (maximum anchor error 0). The correction can move a position a long way: up to **88.5 m**
(Singapore qualifying), 54 m (Singapore race), 39 m (Bahrain race). That is large against corner geometry, and is the reason the
feature is optional, off by default and described as an estimate in `estimated-alignment.md`. No defect found.

## 5. `session_loader.py` network code

Twelve tests with the network replaced (`scripts/test-session-loader-network.py`): a normal answer, a 503 or a connection
failure or a timeout on the primary host falling back to the mirror, both hosts failing raising instead of returning nothing, a
feed missing everywhere raising, byte-order marks, blank and malformed lines, an empty feed, record ordering, short records, and
window bounds. All pass without changes: the code does what it says. It has no retry or backoff for 429 or 5xx beyond the mirror
fallback; callers handle that (the server answers 503 with `Retry-After`).

## Not done

- Whether the physics is *right* in an absolute sense (that a car's lap time is explained by its cornering, straight and braking
  parts). Teammate agreement shows the metrics measure something that belongs to the car, not that the decomposition is complete.
- The cause of the laps whose distance disagrees (upstream data, the capture, or a real calibration difference).
- `trace-batch` end to end: its car outputs are the same `speed_domain_metrics` exercised above, but the endpoint itself (request
  windows, caching) was not driven.
