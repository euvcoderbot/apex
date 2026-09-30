# Car performance audit — 30 September 2026

## Changes from this audit

- Tyre evidence now has linked team, driver, Grand Prix and individual-run selectors. The previous plot was a single longest stint, not an Aston-only season analysis. Rankings still use all eligible evidence; changing the evidence plot does not change those rankings.
- Acceleration no longer intersects the entrants across every zone. A robust additive car/physical-zone fit connects partially overlapping observations. Each zone still requires three comparable cars. Disconnected groups cannot share a ranking baseline, and cumulative loss is unavailable where zone coverage differs.
- Season event-effect fits also reject disconnected comparison groups instead of inventing a common zero. Shared observations bridge unequal coverage, but this is an estimated effect, not a directly observed complete lap.
- Corner-band average speed is distance divided by traversal time, not an unweighted mean of differently sized corners. Alignment corridor indexing uses the actual distance grid rather than assuming exactly five metres per point.
- Low-speed acceleration applies the stated 70% throttle threshold consistently in both extraction paths.
- Race-pace sensitivity reuses the central 2-second traffic fit instead of calculating it twice.
- Reliability no longer overrides supplied classification statuses with unlinked incident notes. Generic retirements remain unknown. Missing championship points remain missing in the chart, not zero.
- Development progression uses chronological qualifying observations when calculating opening/latest medians and the trend.

## What each category can actually establish

| Category | Meaning and important limits |
| --- | --- |
| Qualifying | Fastest eligible lap across Q1/Q2/Q3 per team. Driver execution, session evolution and tyre choice remain in the result. Phase/evolution adjustment is a diagnostic, not a replacement for the official best lap. |
| Race pace | Matched dry, green-flag, traffic-screened laps with assumed fuel correction and compound/age adjustment; fastest supported teammate. Traffic sensitivity and sample support matter. It is not a race finishing-order predictor. |
| Corners | Same physical windows, field-defined speed classes and qualifying-lap timing attribution. Apex speed alone cannot measure corner performance or isolate downforce. |
| Straights | Traversal time includes exit speed and energy deployment. Speed-band acceleration is separate: a car can accelerate quickly through one range without covering the whole straight fastest. Different 2026 battery strategies are not identifiable from speed alone. |
| Braking | Qualifying observations through matched speed reductions and shared approach windows. Public brake state is not pressure. Deceleration, distance and traversal time describe different aspects and need not rank cars identically. No component should be called isolated brake hardware performance. |
| Tyre age | Robust within-run lap-time change with increasing tyre age, by exact compound nomination. Equal driver/event weighting avoids letting a single long stint dominate. Fuel correction is assumed, not measured. Traffic, management, temperature and track evolution remain confounders; a low slope is not proof of superior tyre wear. |
| Pits | Stationary service time and pit-lane duration are different supplied channels. Exact visits, distribution summaries and raw versus GP-relative views remain separate. Missing stationary measurements are not reconstructed from lane time. |
| Development | Relative qualifying progression, not a causal estimate of upgrade gains. Driver changes, circuits and weather can explain apparent improvement. |
| Reliability/results | Official classifications and points. Unknown causes stay unknown; cause-labelled mechanical counts may undercount failures. Finishing results do not isolate car pace. |

## Sources and verification

- [OpenF1 channel definitions](https://openf1.org/docs/) distinguish stationary stop duration from lane duration and document their coverage.
- [Formula 1's braking explanation](https://www.formula1.com/en/latest/article/rob-smedley-explains-how-the-new-aws-braking-performance-graphic-works-and.3A8cnQLZGXFbMjCR2fFBnB) describes the broadcast graphic, which has richer underlying telemetry than the public feed. Interpolation cannot create equivalent new measurements.
- Deterministic regressions exercise partially overlapping acceleration zones, disconnected ranking groups, multi-team tyre plot selection, tyre aggregation, pit summaries, qualifying selection, braking support, and classification handling.

This is a code/methodology audit with regression checks, not a claim that every season's underlying feed has been independently verified. Additional credible improvements require uncertainty estimates and controlled sensitivity checks rather than forcing rankings to match expectations about the leading teams.
