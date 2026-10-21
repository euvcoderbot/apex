# Metric audit — 20 October 2026

A pass over every calculation on the Car Performance page. Each finding was checked
against 2026 data through the app's own pipeline before anything changed.
The car-telemetry categories are covered in
[`speed-domain-methodology-20261020.md`](speed-domain-methodology-20261020.md).

## Fixed

| Metric | Problem | Evidence | Change |
| --- | --- | --- | --- |
| Qualifying pace | The headline compared each team's best lap from any phase. Teams out in Q1 never get the track evolution Q3 runners get. | Over 10 sessions in 2026, the median Q1→Q3 improvement of Q3 runners was 0.7–1.3 s (0.7–1.4% of a lap). | The existing evolution-adjusted view is now the default. Each team takes its best phase after the field's median Q1→Q2 and Q2→Q3 shifts; the adjustment passed its quality gates in all 10 sessions. A session that fails the gates keeps its fastest-lap gap instead of being dropped. |
| Qualifying pace (adjusted) | A Q3 team was pinned to its Q3 lap even when its adjusted Q2 lap was better. | Code review. | Uses the best of every phase reached, each moved to Q3 conditions. |
| Development trend | Used raw qualifying gaps, so a team moving from Q1 exits to Q3 runs showed about 1% of fake improvement. | Follows from the qualifying finding. | Uses the evolution-adjusted gap per GP. |
| Tyre trend | Per-stint lap-time slopes with laps in traffic included by default and a fixed 0.060 s/lap fuel assumption. Each team was compared on its own mix of compounds and races. | 10 races, 2026: none of the four variants of the old measure had positive teammate agreement (−0.08 to −0.25); 36% of stint laps were in traffic. | Joint model per race on clean-air laps: stint pace + shared race-lap effect (fuel and track evolution from the data) + driver × compound tyre-age slope, compared within compound. Teammate agreement +0.28 through the app pipeline. |
| Pit stops | A time penalty or stop-and-go served in the box counted as a slow service stop. | Code review: no race-control check. | Race-control penalty notices mark the driver's next qualifying stop as `penalty-served`. It stays in the evidence table and leaves the stationary and pit-lane rankings. Regression test added. |
| Cornering, braking, straight line, traction, energy | See the methodology doc: window timing restated the lap-time order, and corner windows often measured entry or exit speed. | Teammate agreement, 21 qualifying sessions. | Segment-based speed-domain metrics; braking passes for the first time. |

## Checked, no change

- **Race pace:** robust driver effects with shared race-lap, compound and tyre-age terms, a 2 s
  clean-air screen, an identifiability check, and traffic sensitivity at 1.5 / 2.0 / 2.5 s. The team
  value uses its quicker driver, consistent with qualifying.
- **Race speed traps:** compared on the same race laps against the field median; raw maxima are
  kept as context.
- **Pit statistics:** median by default, trimmed and capped means only with ten or more stops.
- **Reliability:** retirement causes come only from status text or a verified list. Unknown causes
  stay unknown rather than counted as mechanical.

## Still limited

- **Traction** fails validation in 2025 and stays marked low confidence.
- **Braking** single-GP differences under about 2% are within 4 Hz sampling noise.
- **Tyre trend** shows observed pace change, not physical wear. Slower cars put less energy into
  their tyres, so low degradation does not mean a fast car.
- **Qualifying evolution adjustment** uses the field's median improvement. A team that improves
  much more or less than the field between phases is not individually corrected.
