# Performance baseline (2026-10-31)

Measured with `node scripts/perf-baseline.mjs <origin>` against `scripts/serve-static.mjs`, Chromium, 1440x900, cold cache, median of 3
runs, the recorded fixture replayed with no network (so server time is excluded). One developer machine: use the numbers to compare a
change before and after on the same machine, not as absolute targets. Each run loads the view, then clicks through every category tab
and one table sort; INP is the slowest of those interactions.

| View | LCP | CLS | Main thread blocked beyond 50 ms (load + clicks) | INP | Transferred |
|---|---|---|---|---|---|
| Home | 292 ms | 0.001 | 0 ms | 0 ms | 458 KB |
| Car performance, Pace | 792 ms | 0.001 | 335 ms | 120 ms | 2006 KB |
| Car performance, Cornering | 1052 ms | 0.001 | 331 ms | 112 ms | 2006 KB |

## What changed

The first baseline (load only, no clicks) had Cornering at LCP 1756 ms and 893 ms of blocked main thread. A CPU profile showed the cost
was synchronous layout forced by the render cycle, not computation:

- `capturePerformanceUI` read `scrollLeft/scrollTop` of every table at the start of each render, which forced a full layout of a page that
  had just been changed. Positions are now remembered from scroll events.
- `restorePerformanceUI` wrote scroll positions even when they were 0; it now writes only real positions.
- `placeThumbs` (`ui-system.js`) alternated a layout read and a style write for each segmented control; it now reads all, then writes all.

Same load measured the same way afterwards: Cornering LCP 1124 ms, blocked 156 ms. Layout shift stays at 0.001 (it was 0.067 before the
status-strip fix).

## Remaining
- Roughly 130 ms of the load is the one unavoidable layout of a 7,500-element page (it shows as `measureThumb` in a profile).
- INP is good (under 200 ms) on this machine and recorded data; it was not measured on a slow device.
