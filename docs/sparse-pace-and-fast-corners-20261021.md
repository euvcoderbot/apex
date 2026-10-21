# Sparse race pace and mapped fast corners

## Race pace v13

The standard fit and its ten-lap, >2 second checkpoint screen are retained.
Only teams without a standard supported driver use recovery:

1. Fit drivers with at least five known-age, clear-air laps. Five to nine laps
   are provisional. Existing driver estimates remain unchanged.
2. If that contrast is unsupported, fit eligible known-traffic laps with the
   same race-lap, compound and tyre-age terms plus a shared linear proximity
   term `max(0, 2 - checkpoint_gap_seconds)` in log lap time.
3. Re-anchor recovered contrasts against the same standard reference driver.
   At least three drivers must be common to the standard and recovery fits.

Unknown traffic gaps, non-green laps, wet laps, pit laps and the opening two
laps are not filled. Driver contrasts must pass the null-space identifiability
check, convergence check and contrast-noise-gain limit. Traffic coefficients
above an absolute two log-percentage points per gap second are rejected.

The shared traffic coefficient is an assumption, not a causal aerodynamic
correction. Tyre strategy, driving and energy management can confound it.
Recovered results are provisional; a driver whose observed gaps never reach
two seconds is additionally marked as a clear-air extrapolation. Residual
spread is a model diagnostic, not a confidence interval. A model cannot
recover a driver from absent timing or an unidentifiable comparison group.

UI coverage counts supported events separately from provisional estimates;
one unavailable event no longer labels every other event a limited sample.
Old v12 result caches cannot migrate into the v13 calculation.

## Fast-corner detection

The previous detector required a pronounced local speed dip. Linked fast
turns can carry speed without two distinct dips, especially on a ~4 Hz feed.
Normalized Sepang map anchors were also discarded before segmentation.

Map anchors are now projected to the shared GPS centreline. A candidate fast
turn requires observed field speed over 200 km/h, sustained curvature with
median lateral-acceleration proxy at least 1.2 g, and net heading change at
least 0.15 rad across its local arc. Neighbouring mapped turns bound the arc.
These checks reject isolated GPS kinks and straight-line speed dips.

Each car uses its own local speed minimum where present. Broad apexes can use
a fully observed +/-35 m window about the field corner point, with at least
three packets and no source gap over 0.6 s. Such estimates are provisional.
Time near apex is capped to the corner's own arc; it cannot span later turns.
This measures delivered speed through a bend, not isolated grip or downforce.

On the recorded 2026 Sepang qualifying input, T5 and T6 are distinct at about
240 and 235 km/h field-median measured apex speed. T12/T13 also pass the fast
bend checks. Speeds and detection sources are exposed in the per-GP evidence.

## Verification

Known-effect simulations verify sparse contrasts, a shared traffic effect,
unchanged standard drivers and rejection of unknown traffic. A constant-speed
two-bend test verifies that T5/T6-like arcs remain separate without speed dips;
the same markers on a straight yield no corners. Existing physics tests cover
power/grip/braking separation and telemetry support requirements.
