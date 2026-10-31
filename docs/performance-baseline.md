# Performance baseline (2026-10-31)

Measured with `node scripts/perf-baseline.mjs <origin>` against `scripts/serve-static.mjs`, Chromium, 1440x900, cold cache, median of 5
runs, the recorded fixture replayed with no network (so server time is excluded). One developer machine: use the numbers to compare a
change before and after on the same machine, not as absolute targets.

| View | LCP | CLS | Main thread blocked beyond 50 ms | Transferred |
|---|---|---|---|---|
| Home | 288 ms | 0.000 | 0 ms | 457 KB |
| Car performance, Pace | 1180 ms | 0.000 | 409 ms | 1977 KB |
| Car performance, Cornering | 1756 ms | 0.001 | 893 ms | 1977 KB |

Findings:
- Layout shift is gone after the status-strip fix (Cornering was 0.067 before).
- Cornering blocks the main thread for about 0.9 s while it builds charts from the data. That is the largest remaining cost and the
  first place to look (chunk the rendering, or render the visible category only). Not changed here.
- Interaction latency (INP) is not measured by this script; it needs real input and is left for a manual trace.
