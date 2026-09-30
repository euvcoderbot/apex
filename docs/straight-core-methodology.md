# Settled straight-section performance — 30 September 2026

## Research and audit

F1/AWS publicly describes dividing circuits using lateral acceleration, speed and other telemetry, then comparing time spent in those sections. The exact physical model and scoring formula are not public. It cannot be copied faithfully from the public low-rate feed.

Source: https://www.formula1.com/en/latest/article/rob-smedley-on-car-performance-scores-and-the-data-behind-the-latest-f1.5QoyFi4KL63EULKM4u5mGL

F1 also describes finish-line speeds as a combination of corner exit speed and drag, illustrating why one speed trap or exit-inclusive elapsed time cannot identify drag alone.

Source: https://www.formula1.com/en/latest/article/tech-tuesday-how-mclaren-engineered-a-shock-1-2-at-low-drag-monza.4gp6QdkJQnroF9P1e0Afil

The 2025 replay reproduced the existing 23-event ranking exactly: Mercedes was 0.055020 percentage points behind McLaren. First-100-m exit regions alone contributed 0.080131 points of that difference. A diagnostic removing early exits, braking edges and curved/partial-throttle sections changed the ranking. This justified separating the definitions, not manually changing a team's score.

## New primary measurement

One validated clean qualifying lap per team, with identical registered windows for every team in an event:

- Every team must be at least 98% throttle, without observed braking.
- Exclude 200 m after the detected corner exit and 100 m before the next detected corner region. These are conservative screening buffers, not universal physical boundaries or a claim that exit influence vanishes after 200 m.
- Smoothed reference GPS heading change must be below 5 degrees over roughly 50 m; the field-speed/curvature lateral-acceleration proxy must be at most 0.5 g. This proxy is not a directly measured accelerometer channel.
- Match observed DRS states across teams. Unknown or unchanging channels cannot establish true 2026 active-aero equivalence.
- Reject native source gaps above 0.6 seconds. Interpolation creates no additional independent observations.
- Retain continuous runs at least 100 m long and total shared coverage at least 200 m. Otherwise return null, never zero. At least three teams are required.
- Measure registered elapsed time from the same selected qualifying laps. Per-event gap is excess measured seconds over the fastest team on these windows divided by the reference official qualifying lap time, times 100.
- Average event-relative measurements with equal GP weighting and the existing connected event-coverage adjustment. Report GP coverage and measured window distances; raw seconds across different circuits are not comparable.

## Separate diagnostics

Peak speed, official speed traps, end-of-straight speed and selected speed-range acceleration remain separate measurements. The former primary traversal chart is retained inside explicitly labelled exit-inclusive lap attribution; it remains additive with the old corner partition. The new partial-window measurement does not add to the corner metric to reconstruct a lap.

No synthetic weighted engine/drag score is inferred. Tow, incoming speed, wing level, DRS/active aero, driver execution, weather and energy deployment remain influences. In 2026, full-throttle speed loss is retained; lift-off sections are excluded by this definition, so this is not an overall energy-management or full-straight race-performance score.
