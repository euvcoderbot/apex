# Fastest-lap paired braking

Both views use one real team lap: the quicker driver's fastest eligible official
qualifying lap across Q1/Q2/Q3. Neither speed-drop timing nor approach timing
averages repeated attempts. If that exact lap fails telemetry/alignment quality,
do not replace it with a slower lap or the teammate's lap.

The backend keeps validated fallback laps for other telemetry categories, but
selects braking independently by the requested fastest lap's driver, lap number
and time. Returned measurements record that source selection, zone bounds,
speed-threshold crossing positions, boundary speeds and native sampling evidence.

The frontend chooses one complete observed team-by-zone rectangle from records
where both timings exist. Both views share that rectangle. Season aggregation
also chooses one complete team-by-GP rectangle shared by both metrics. Physics
summary cells use those same ranked GPs. The coverage-adjusted model toggle does
not change braking into separately inferred rankings.

Shared ranking support lists the actual ranked teams/zones/GPs. Leave-one-zone
or leave-one-GP-out ranks hold the cohort fixed and expose sensitivity; they are
not confidence intervals. A single shared observation cannot support that test.
The evidence panel retains unranked fastest-lap observations and unavailable
teams, explicitly identifying them. Three-decimal formatting remains an estimate.

Compatibility: if the separate API lacks `fastest-qualifying-lap-only` metadata,
the dashboard requests exactly one fastest lap per team in a separate batch.
This prevents the older API from averaging repeats or finding slower fallbacks.
The frontend additionally requires one source lap and validates source identity
against qualifying metadata. An older mixed-repeat response is never relabelled
as a fastest-lap observation. Other telemetry results are left unchanged.

Verification: UI regression cases check shared cohorts, GP support, fixed-cohort
rank stability, mismatched sources, repeat rejection and the previously hidden
valid approach result. Python cases check exact fastest-lap identity, absence of
fallback, original-timestamp physics and rejection of missing/sparse evidence.
Native replays of China 2025, Baku 2026 and the recent Sepang selection confirm
one source lap per returned measurement. Red Bull's earlier Sepang comparison
used lap 8: its fastest official lap is 11 and fails the current validated
telemetry path. It is now unavailable rather than scored from lap 8.
