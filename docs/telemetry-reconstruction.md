# Enhanced telemetry reconstruction

Accurate mode retains the existing measured-sample paths and timing algorithm.
Enhanced mode is an explicitly estimated reconstruction, not a higher-rate
measurement. The public channels cannot uniquely recover missing telemetry.

## Model

- Reconstruct speed against elapsed time, so the local slope represents
  acceleration. Use a separate monotone distance-to-time registration through
  original alignment knots; do not alter GPS alignment to make speeds agree.
- Use shape-preserving piecewise cubic Hermite interpolation (PCHIP) through
  every trusted sample. Each interval uses its two endpoints and neighbouring
  slopes. Adjacent intervals share derivatives; no spline overshoot beyond
  endpoint speeds is permitted. Measured extrema remain fixed.
- Replace the old cascade of broad smoothing, monotonic regression, envelope
  fitting and throttle snapping with one evidence-gated repair pass. Do not
  progressively smooth already-modified observations.
- Remove only isolated, extreme one/two-sample excursions with implausible
  entry AND exit acceleration and unchanged controls/gear; or short identical
  speed holds corroborated by both surrounding acceleration trends or RPM
  movement in the same gear. Use the immediately surrounding distinct samples
  as anchors. No repeated-speed repair crosses a power-phase gear change,
  partial input, sustained limiter shelf or steady-RPM shelf.
- Missing/nonfinite/out-of-range speed samples produce an estimated gap.
  Gaps longer than 1.5 seconds or with ambiguous inputs are low confidence.
  No speed is extrapolated beyond valid channel boundaries. Long missing
  intervals cannot reveal unseen corners or hidden extrema; the conservative
  bounded bridge is not a claim that the car followed that exact trajectory.
- Brake is an on/off observation, not brake pressure. Full throttle is not
  proof of constant acceleration. RPM is corroborating evidence, not a speed
  replacement: tyre slip, gearing and asynchronous packets matter.
- Throttle is interpolated separately through every supplied value, bounded
  to 0–100. Do not turn 97/98% samples into 100%, or create bumps on a 100%
  plateau. Brake, gear and DRS remain discrete midpoint step traces.

PCHIP supplies a local, acceleration-continuous approximation, not a complete
vehicle dynamics simulation. Mass, aero setup, grade, wind, tyre force, energy
deployment and actual brake pressure are not sufficiently known to claim a
uniquely physics-correct trajectory. Suspicious but ambiguous observations are
kept rather than erased. The shape-preserving method follows the
[PCHIP construction documented by SciPy](https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.PchipInterpolator.html).

## Timing and rendering

Enhanced delta integrates the same reconstructed speed with Simpson's rule
for `dt/ds = 1/v` on an approximately 2-metre grid. Sector durations and the
finish are calibrated to official timing. That calibration necessarily adds
timing information not present in raw speed integration; delta is not simply
an independent decorative smoothing pass. Accurate integration is unchanged.
Both modes are cached separately. Axis bounds cover both modes, avoiding a
scale jump when toggling the checkbox.

The displayed speed/throttle path includes every source-position knot and
the exact current hover position. Curves, markers and tooltip values use the
same evaluator. All telemetry canvases use one horizontal plotting inset.
Repaired regions are identified in the tooltip, with a separate warning for
low-confidence gaps. Geographic map selection stays independent of the
reconstruction and can borrow geometry from another selected lap.

## Validation (2026-09-05)

Run `node --test scripts/test-telemetry.mjs` from the project root.

Eleven checks cover immutable/trusted samples, extrema, bounded interpolation,
corroborated holds, genuine shelves and shifts, spikes, gap-join continuity,
null channels, duplicate timestamps, throttle bounds, canvas coordinates,
hover consistency, official delta anchors, stable delta axes and mixed-GPS
map rendering. Optional cached-data tests use `.apex-cache` without shipping
those files to the site.

The cached regression corpus has 46 laps; 188 speed samples are classified for
repair. A deterministic masking experiment removes two consecutive samples
from every eligible steady-control window (deduplicating identical payloads).
Across 1,686 held-out observations, mean absolute error is 1.709 km/h versus
1.736 km/h for time-linear interpolation. In 818 observations from windows
with at least seven distinct adjacent changes and no detected repair in the
unmasked window, errors are 0.951 versus 1.089 km/h. These overlapping windows
are a regression benchmark, not independent ground-truth validation. The
all-data worst error is 59.246 km/h: stale/corrupt observations and unseen
events remain unresolved. Do not present the subset's improvement as a
guarantee across circuits, long gaps, or damaged input.
