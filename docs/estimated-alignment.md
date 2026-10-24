# Optional estimated distance alignment

The **Correct alignment (estimated)** checkbox starts off on each page load.
OFF retains the existing GPS-position projection (or its established distance
fallback), unchanged. This is the original processed comparison, not a claim
that public telemetry provides assumption-free ground truth. Switching OFF
restores the exact original mapping, not an inverse of an already-warped curve.

## Why this alternative

Approximate position packets and speed packets do not always agree. The COTA
2026 FP2 ANT L8 / VER L9 comparison is strongly sensitive to the mapping near
T12. Matching braking features can reduce that discrepancy, but also erase real
differences in braking location. We deliberately do **not** use cross-driver
speed correlation, local/global feature shifts, dynamic time warping, guessed
clock offsets, or filters fitted to remove the delta dip.

The optional model uses each lap's own native speed and elapsed times:

1. Integrate time-linear speed with the trapezoidal rule (`distance = ∫v dt`).
   No moving average, spline, or reconstructed speed is used for registration.
2. Evaluate this integral at official S1, S1+S2 and finish times, using the
   retained provider time origin. Between packets the integral is quadratic,
   consistent with linearly changing speed.
3. Normalize each sector's cumulative distance to shared sector-line fractions
   from the same spatial-reference selection as the original mode. These
   fractions are estimated from reference telemetry, not surveyed FIA distances.
4. Apply that shared mapping to every chart channel, hover/readout, corner
   analysis, and dominance map. Existing sector/finish time calibration remains
   exact. Derived interpolation and timing caches are invalidated on switching.

### Assumptions and safeguards

- Equal distance between shared sector lines is an approximation: racing lines,
  sensor bias and missing packets still matter. This mode is not guaranteed more
  accurate locally, even when traces look closer.
- Recorded speed, time, distance, GPS and driver inputs are never rewritten.
  Only the derived horizontal mapping changes. Original extrema stay recorded;
  their displayed positions can move. Both laps may still have different minima.
- Requires complete positive sector timing and at least 12 finite speed packets,
  strictly increasing timestamps, no interval over 1.5 s, speeds within 0–450 km/h,
  nonzero integrated sector travel, and start/finish coverage within 0.5 s.
- A missing boundary interval up to 0.5 s holds the nearest speed. This is an
  explicit estimate, not a new observation. Longer boundary absence is rejected.
- Pit-in/out, incomplete, corrupt or unsupported laps retain their original
  mapping. The visible status names each retained lap and its reason. Mixed
  eligibility is permitted and disclosed; it is not silently called corrected.
- Shorter packet gaps still contain unknown motion. The source-gap dashed lines
  and tooltip warnings remain in both modes. Their threshold is not an error bar.
- The existing enhanced speed reconstruction, if enabled separately, does not
  feed back into distance registration. Switching it cannot progressively move
  braking points.

## Evidence and validation

`node --test scripts/test-telemetry.mjs` checks an analytic speed integral,
native-channel immutability, origin handling, rejection cases, distinct braking
locations, both timing modes' official anchors, full UI painting, repeat switches,
and exact restoration against a SHA-256 golden of the pre-checkbox COTA mapping
and 1,001 delta samples.

`node scripts/audit-alignment-correction.mjs` replays 150 laps: COTA FP2, Sepang
FP3, and retained qualifying/race recordings from Singapore, Bahrain/Sepang and
Azerbaijan. It checks finite monotone
mapping, official timing anchors, native observations and bit-exact restoration.
It does not establish true cross-driver position or rank one mapping's accuracy.
All 150 passed these invariants. The largest departure from the original mapping
was 88.5 m in the corpus, so this is a substantive alternate estimate, not a
claim of a tiny universally safe adjustment. For the sampled COTA T12 window
(3,400–4,000 m), the minimum VER-minus-ANT delta changes from −0.189 s to +0.140 s;
the exact sector and finishing gaps remain unchanged. Neither local value is
independently validated ground truth.

Primary background: [OpenF1 location documentation](https://openf1.org/docs/#location)
describes approximate track coordinates; [FastF1's telemetry implementation](https://github.com/theOehrly/Fast-F1/blob/main/fastf1/core.py)
documents accumulated distance integration error. Sector anchors constrain that
drift but cannot independently validate the delta between timing lines.
