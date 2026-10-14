# Shared corner positioning — 14 October 2026

## Change

Car corner measurements previously centred their windows on projected map labels. Session analysis independently chose the largest local curvature sample. Both now use `corner-position.js`, which searches native GPS direction change on a bounded spatial grid and centres the supported same-direction bend lobe. Speed is not an input to positioning.

The search is restricted to 125 m either side of the named marker, stays inside neighbouring marker midpoints, and never crosses the timing line. GPS brackets above 80 m, one second or the original source-interval limit are unsupported. Weak, narrow, edge-clipped and missing-GPS bends keep the original marker with an explicit reason. Original marker coordinates remain available for source-lap alignment; they are not replaced with independently moving driver speed troughs.

Supported geometry uses field-median speed at the same estimated bend centre for every entrant. Unsupported geometry retains the previous ±25 m marker-area speed estimate, explicitly uncertain. The numerical speed-band thresholds are unchanged. Qualifying and race traversal windows now centre on the same geometry method; timing coverage and local native-gap exclusions remain in force.

Session speed annotations use `bend` for supported geometry and `marker ≈` for fallback positions. Slow-corner labels remain observed window minima rather than claiming measured apex speeds. The optional annotation control remains off by default. A collapsed car-performance evidence table lists every position method, signed shift, speed and fallback reason.

## Replays and tests

- Singapore 2026: 19 named turns preserved; 18 supported GPS refinements. T11 retains the uncertain map marker. Largest shift approximately 48 m at T4.
- Local measured endpoint: all 11 requested team laps and all 21 requested driver laps received, complete, no request errors. Both views return identical positions and classification bands and retain all 19 timing windows per lap.
- Singapore high-speed field-reference estimates: T6 298.231, T15 253.063, T18 207.455, T19 210.196 km/h.
- Suzuka 2025 fastest-lap geometry: all 18 named turns refined; largest shift approximately 94 m. This is a geometry replay, not independent proof of true racing-apex location.
- Baku 2026 fastest-lap geometry: 20 named turns preserved; 15 refinements and five explicit fallbacks (T8–T11 and T20). Close track crossings never substitute a different named turn.
- Sepang native qualifying and race fixtures still pass; T5/T6 remain supported high-speed bends. Existing missing-packet and displaced-archive checks pass.
- 148 automated regression tests passed, none skipped. New checks cover deliberate marker displacement, speed-invariant positions, neighbouring turns, unsupported GPS, registered session coordinates and shared frontend/server wiring.

## Limits

GPS curvature gives an estimated bend centre, not a measured geometric apex or each driver's track-edge clipping point. A fixed speed-band cutoff is still an analytical convention; small speed changes can change borderline classification. Sparse GPS is not densified into additional evidence. First calculation after this geometry revision recomputes derived corner caches; unchanged raw source caches are retained.

Browser visual QA remains unverified in this environment. Endpoint replays, source wiring checks and automated regressions verify the calculation and integration; they do not establish fresh visual verification.
