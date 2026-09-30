# Straight-line correction — 30 September 2026

The live 2025 reconstruction reproduced all chart ranks over 23 supported events. All ten teams shared these events; the season effect fit therefore reduced to the rebased event means. Mercedes–McLaren was 0.041701 percentage points, averaging 0.055 seconds of straight time per GP. Las Vegas had no eligible dry candidates.

## Confirmed faults

1. Terminal speed divided reference distance by another car's locally warped elapsed time. A China 2025 Racing Bulls window produced 475.20 km/h although the integrated speed channel supported 334.24 km/h. Ferrari and Haas also produced impossible values.
2. Terminal averages could contain different windows per team while reporting event-wide, rather than team-supported, measurement distance.
3. Telemetry extraction reset the first buffered car sample to elapsed zero. The buffered records include samples outside the official lap; variable packet offsets shifted drivers differently.
4. Whole-lap timing agreement did not constrain how GPS projection moved elapsed time between straight and corner windows.
5. Acceleration combined extra candidate laps while traversal used one selected lap.

## Implemented corrections

- Establish one request-scoped session clock using FastF1's maximum sample UTC minus feed elapsed-time convention across car and position streams. Clip to official absolute lap boundaries; interpolate only those two edges. Native interior car samples remain unchanged. Reject boundaries not bracketed by available samples.
- Interpolate position to car timestamps only where adjacent positions are at most 0.6 seconds apart; preserve missing GPS rather than bridge large gaps.
- Use official sector lines to register integrated distances with one scale per sector. Reject sector distance scales differing by more than 3%. GPS still verifies circuit correspondence. Without valid sector anchors, reject local GPS distortion exceeding 10% across 200-m windows.
- Keep elapsed-time partitioning additive. Sector registration is still an estimated racing-line correspondence, not exact physical surveying or an independent measure of engine/drag performance.
- Compute distance-weighted harmonic end speed directly from the speed channel. Retain only windows supported by every measured team in that event; missing common windows yield null. Report the actual common window distance and count.
- Use the same selected valid qualifying lap for acceleration and traversal; other candidate laps are only quality fallbacks. Braking's repeated-lap diagnostic remains separate.
- Expose actual straight seconds, selected laps, registration method and end-speed GP coverage in the dashboard. End-speed headings no longer confuse the long-straight eligibility threshold with the short measurement-window length.

## Verification

Synthetic regressions cover buffered lap-start offsets, official timing-line registration, impossible terminal speeds from warped time, common-window exclusions and additive elapsed time. China 2025 retained all ten teams after correction; shared end-speed values were approximately 298–303 km/h rather than approximately 282–333 km/h from inconsistent/inflated corridor measurements. These speeds average several different straights, not a peak-speed trap.

The corrected overall ranking must be recomputed; the old ranking is not preserved as a target. Public sampling, traffic/tow, weather, driver execution, racing lines and deployment remain limitations. No claim is made to isolate engine power or aerodynamic drag.
