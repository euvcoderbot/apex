# COTA FP2 telemetry evidence trial

Scope: 2026 United States GP, OpenF1 session 11390, ANT L8 and VER L9.
Original position packets at lap seconds 45–70 were held out in disjoint
interior blocks of one or three packets. Neither predictor could see the
withheld coordinates. This tests prediction of this approximate source, not
true car position, cross-driver alignment, or a clock-offset correction.

| Lap | Held block | Tests | Nearest median error | Linear median error |
| --- | --- | --- | --- | --- |
| ANT L8 | 1 packet | 31 | 122.801 | 11.291 |
| ANT L8 | 3 packets | 54 | 195.760 | 19.896 |
| VER L9 | 1 packet | 30 | 127.883 | 16.543 |
| VER L9 | 3 packets | 54 | 160.705 | 25.447 |

Errors are in source-coordinate units, **not metres**. Linear prediction won
168 of the 169 held-out comparisons, but the production-alignment replay's
T12 delta minimum changed from -0.188534 s to -0.222531 s, not to zero. Official
sector/finish anchors remained [0, -0.141, +0.330, +0.147] s. This is insufficient
evidence to select the true intra-sector delta. No position interpolation,
clock correction, speed-minimum snapping, or delta-method change was deployed.

Verified source gaps at ANT's T12 exit are 60.052–61.013 s (car packets,
0.961 s) and 60.126–61.025 s (position packets, 0.899 s). The presentation
change marks unusually long **car-packet** intervals with dashed lines and
reports the measured interval on hover/in the keyboard readout. It does not
claim to detect all position uncertainty from the already-joined payload.

Gap selection reuses the existing reconstruction cadence rule: an interval
greater than max(0.6 s, 2.2 × median positive packet cadence). That rule flags
an interval for presentation; it is not a physical error bound or a confidence
interval. Native endpoints remain measured, and numeric results are unchanged.
The timing-delta indication includes gaps in either constituent lap, even
when the reference speed trace is hidden. It does not bound accumulated
integration error outside a gap or certify alignment elsewhere.
