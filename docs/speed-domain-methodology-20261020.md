# Speed-domain car metrics — 20 October 2026

Implementation: [`car_physics.py`](../car_physics.py), returned as `speed_domain` by
`measure_field` (`car-measurements-v16-speed-domain`) and shown by default on the Car
Performance Cornering, Straight line and Braking tabs. The window-timing method is still
returned and reachable with the method toggle.

## Why the window-timing categories disagreed with real car behaviour

The window-timing categories time each car through shared distance or speed windows on
one ~4 Hz qualifying lap. Effects that are not car performance leak into them:

- **Entry speed.** A car that exits a corner faster is quicker through every later window,
  so cornering gains appear as straight-line speed and vice versa.
- **Registration.** A few metres of distance misalignment move tens of milliseconds between
  neighbouring windows, about the size of real car gaps.
- **Window placement.** Published corner markers are label positions, often tens of metres
  off the racing line. A window at a lap-distance fraction often measured entry or exit
  speed at its edge instead of the apex.

Measured result: after removing each driver's overall lap-time position, the window-timing
corner categories carried no car-specific signal (teammate agreement −0.28 to −0.04 in 2025,
−0.05 to +0.18 in 2026). They mostly restated the qualifying order.

## What the public feed contains

| Channel | Detail |
| --- | --- |
| Speed, throttle, gear, RPM | ~4 Hz (median 0.24 s, 5% of gaps over 0.4 s); speed in whole km/h |
| Brake | On/off only, no pressure |
| Position | X, Y, Z at the same rate (Z is elevation) |
| Aero state | 2025 DRS closed/open; 2026 empty (active aero not published) |
| Timing | Sector times, mini-sector flags, I1/I2/speed-trap speeds |
| Context | Race control (yellow flags by qualifying phase), weather, tyre stints |

**2026 energy limits.** 2026 cars lose speed at full throttle for up to 23% of a lap (energy
clipping at Spa, Silverstone, Suzuka). In 2025 this was 0–4% at most circuits. A 2026 straight
is often energy-limited, so it cannot be read as engine power or drag.

## Circuit segmentation (audited)

`scripts/audit-circuit-segments.py` and the circuit segment audit report classify every 5 m
of each circuit from the field median, after registering every lap to one centreline by
GPS projection.

- **Corner:** a minimum of the field's speed at least 10 km/h below the fastest point within
  300 m. Phases: braking (half the field on the brake), entry (off the brake, slowing), apex
  (within 15% of the minimum speed), exit (until the field is back at 98% throttle).
- **Grip-limited corner:** braked, or a minimum taken below 90% throttle. Other minima are lifts
  or energy dips and are not used for cornering.
- **Flat-out bend:** lateral load ≥ 1.5 g at ≥ 95% throttle with no speed minimum.
- **Straight:** ≥ 98% throttle and lateral load < 1 g for at least 100 m.

The segmentation was checked circuit by circuit against the real layouts before any car was
compared.

## Comparisons

| Category | Measurement | Reported as |
| --- | --- | --- |
| Cornering | Each car's own speed minimum inside each grip-limited corner, and the time it spends within 15% of that speed. Time lost ≈ dwell × (field apex speed / car apex speed − 1), summed per band (low ≤ 120, medium ≤ 200, high > 200 km/h). | Seconds per lap behind the best car in each band |
| Braking | Average deceleration from brake onset (placed between packets from the speed already lost) until the car first reaches its own apex speed + 3 km/h. Distances from GPS projection. Each event is divided by the field's decel = c0 + c2·v² at its own speeds, centred per corner, median over corners. | % longer braking distance than the best car |
| Straight line | Full-throttle acceleration a(v) from packets on the audited straights only, per DRS state (2025), at 10 km/h nodes. Each car's curve is run over the same simulated straight: 160→250 km/h, then 500 m from 250 km/h. | Seconds per straight |
| Energy deployment | Speed lost while flat out on the audited straights (clipping, or a tow beyond the drag limit). | km/h per lap above the car losing least |
| Traction | Exit-phase acceleration of grip-limited corners at any throttle, once the car has gained 30 km/h over its own apex, simulated 70→170 km/h. | Seconds per corner exit |

Laps must be within 107% of the session's fastest and within 3% of the car's own best.
Excluded cars are listed with a reason (`excluded`). Up to two validated laps per car;
per-corner values use the median of the car's laps.

## Known-truth tests

`scripts/test-car-physics.py` simulates laps with a point-mass model (downforce, power, drag,
brakes). Each lap samples at its own random phase, as real telemetry does.

- +3% grip appears in every cornering band and in traction, not in straight-line time or braking.
- +5% power appears only in straight-line time.
- +8% braking appears only as braking distance (about 6–7% shorter).
- A 12 m distance error leaves cornering unchanged.
- Two identical cars differ by about 1.9% (one lap) or 1.2% (two laps) in braking from sampling
  phase alone: the noise floor of the 4 Hz feed.

## Real-data validation

Corpus: OpenF1 native car data and positions, each driver's two best qualifying laps; 2025
(9 GPs) and 2026 (12 GPs). Test: **teammate agreement**. A car trait should be shared by
the two drivers of the same car. "Beyond pace" removes each driver's lap-time rank first, so
a metric that only restates the qualifying order scores ≈ 0. No assumption about which team
should be fastest is involved.

| Category | Beyond pace 2025 old → new | Beyond pace 2026 old → new | Driver coverage (new) |
| --- | --- | --- | --- |
| Straight line | +0.09 → **+0.38** | +0.35 → **+0.44** | 97% / 100% |
| Braking | +0.09 → **+0.39** | −0.12 → **+0.27** | 97% / 100% |
| Low-speed corners | −0.22 → **+0.20** | +0.08 → **+0.19** | 97% / 99% |
| Medium-speed corners | −0.28 → **+0.19** | −0.05 → **+0.23** | 67% / 82% |
| High-speed corners | −0.04 → **+0.43** | +0.18 → +0.09 | 54% / 32% |
| Energy deployment | new: **+0.47** | new: **+0.41** | 97% / 100% |
| Traction | new: −0.19 | new: +0.21 | 41% / 97% |

Band coverage below 100% means the circuit has no grip-limited corner of that type
(Monza has no slow corners left once the chicanes are counted as medium; 2026 cars take many
fast bends flat). Mean |correlation| between categories is 0.20 in both years: the categories
measure different things rather than restating one order.

## Limits

- **Traction** fails in 2025 (`reliability: low`); shown as evidence only.
- **2026 high-speed cornering** has few grip-limited corners per circuit.
- **Braking** single-GP differences under about 2% are within sampling noise.
- All values remain delivered performance: car, driver, setup, tow and energy deployment
  together. They are not isolated drag, horsepower, grip or brake hardware.

## Reproduce

```
python scripts/capture-openf1-qualifying.py <laps_dir>
python scripts/audit-circuit-segments.py <laps_dir> segments.json
python scripts/validate-speed-domain.py <repo> <laps_dir> result.json 2 new-only
python scripts/validate-speed-domain-specificity.py result.json new
```

`speed-domain-validation-20261020.json` holds the final validation run with per-driver values.
