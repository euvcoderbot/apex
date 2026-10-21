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
- **Flat-out bend:** lateral load ≥ 1.5 g at ≥ 95% throttle with no speed minimum. Below 3 g a
  flat bend is limited by power and energy deployment, not grip, and is not ranked (Baku T20
  ~1.3 g, Singapore T6 ~1.9 g used to put straight-line speed into the high-speed band).
- **High-load flat bend:** ≥ 3 g sustained, field speed within 8% of its entry speed (Spa
  Raidillon, Pouhon and Blanchimont; Silverstone Abbey). These are ranked, but a window minimum
  there measures entry speed (power) and runs into the next braking zone, so each car's speed at
  the bend apex is scaled to the field's entry speed. A car that stays flat scores about zero; a
  car that has to lift (Cadillac 39% and Racing Bulls 68% throttle in Pouhon) loses time.
- Turns found only from map curvature never replace a speed-minimum corner, are dropped when
  braked (the arc is only the braking entry), and are measured only by one of the two methods
  above, never by a window minimum. Some circuits have no high-speed comparison (Singapore,
  Monaco, Montréal in 2026).
- **Straight:** ≥ 98% throttle and lateral load < 1 g for at least 100 m.

The segmentation was checked circuit by circuit against the real layouts before any car was
compared.

## Comparisons

| Category | Measurement | Reported as |
| --- | --- | --- |
| Cornering | Time over the same fixed stretch of each grip-limited corner: from 10 m before the earliest braking point in the field (brake, not throttle: 2026 cars lift and coast for energy mid-straight) to 10 m after the last car is back at full throttle; overlapping corners are one complex. Split at the field's brake release and last apex into braking, mid-corner and exit. Entry speed is corrected by holding the car's line speed until it meets the field's speed trace; exit speed earns a credit over up to 500 m of the next straight, fading linearly. A car >10% off the field through one corner, or >12% off at entry or exit, is left out of that corner. | One GP: seconds per lap per band. Several GPs: % of the field's time in that band, equal weight per GP |
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
- +5% power stays within ±0.02 s per band of cornering (entry and exit speed are corrected).
- Better brakes show in the braking phase of the corners, not mid-corner or exit.
- Identical cars sampled at different phases agree within 0.03 s per band, also with 1.1 s packet
  dropouts (time at a line assumes constant acceleration between packets, not linear time).
- Positions follow the car's own odometer with a ±100 m GPS offset: nearest-point projection
  alone snaps to the 5 m centreline grid, ±0.1 s through a slow corner.
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

## Corner timing against qualifying (2026, all 17 GPs)

The sum of each team's corner deltas correlates with its qualifying gap at r = 0.96 on average
(0.94–0.99 at 16 circuits; 0.80 at Monza, where the lap is decided on the straights). The previous
apex-speed metric looked at one point per corner and missed braking, entry and exit; it put the
Bahrain and Singapore pole-sitter (Red Bull) mid-field in cornering.

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
