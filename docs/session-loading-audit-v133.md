# Loading and session-layout correction — v133

## Actual loading fix

The Azerbaijan 2026 failure was not a race-selector problem. The archive loader exhausted the primary/mirror paths and raised before trying an available alternate timing source. The primary timing archive returned 401, and the mirror returned 404. This revision adds a working OpenF1 performance adapter and fallback; it does not substitute a more descriptive error for a fix.

The production service also encountered OpenF1 429 responses. The fallback now retries transient throttling/upstream failures with a bounded delay and honours numeric Retry-After. Two validated completed-session source bundles are retained, checksummed and identity-checked. They contain the seven original timing/classification/stint/weather/control/pit/driver feeds, not old performance scores. Every request runs the current analysis. Their original 18 October capture dates determine a 30-day expiry; packaging does not renew that expiry. Explicit refresh attempts the live source and keeps valid retained inputs if that attempt fails. Other sessions use the general live fallback; this release does not promise that all upstream outages can be recovered.

Production verification at `https://apex-telemetry-api.vercel.app/api/performance`:

| Azerbaijan 2026 | HTTP | Source laps | Team entries | Supported pace values |
| --- | --- | --- | --- | --- |
| Qualifying | 200 | 373 | 11 | 11 |
| Race | 200 | 983 | 11 | 9 |

Cold production requests completed in approximately 1.55 s and 3.83 s in this check. These are observations, not latency guarantees. The local browser's Latest 3 flow completed with **3/3 events with data**, no failure alerts, and Azerbaijan included. Unsupported race measurements remain unknown rather than being filled with invented values.

The adapter checks session identities, sector consistency, deleted/reinstated laps, pit laps, stints, weather and race-control neutralisation. Missing weather/flags are not replaced with dry/green defaults. SC IN THIS LAP does not itself restore green status. Lap starts are approximate provider timestamps, not exact F1 timing-line clock observations; see the [OpenF1 documentation](https://openf1.org/docs/).

The production upload allowlist explicitly includes the adapter and retained source bundle. Source/calculation/backend hashes include both, so existing dashboard results invalidate on this release. Raw observations remain separate from derived calculations.

## Layout corrections

- Session analysis / Car performance controls now have equal 2 px shell padding, identical 30 px button heights, and 8 px horizontal button padding.
- Qualifying run selectors are a distinct content-sized control family rather than forced into ordinary single-line segments. Q1/Q2/Q3 retain three equal columns, with tyres and run counts contained inside each choice.
- A real separator divides the overall lap time from sector times. It becomes a horizontal rule in the narrow layout.
- At widths of at least 1440 px the full driver list occupies a 240 px left rail, without a nested vertical scroller. The same DOM node returns to the chooser on compact screens; selection/listeners survive the move. The rail remains available when the lap chooser auto-collapses.
- Live checks at 1920, 1280, 768 and 390 px found no page-wide horizontal overflow or clipped run-button content. All three run choices within each driver remained on the same row. Wide run buttons measured approximately 38 px high; regular header controls remained 30 px.

## Requested Abu Dhabi 2025 qualifying comparison

| Driver | Actual fastest lap | Lap time | S1 | S2 | S3 |
| --- | --- | --- | --- | --- | --- |
| VER | 17 | 1:22.207 | 16.858 | 35.710 | 29.639 |
| NOR | 16 | 1:22.408 | 16.908 | 35.890 | 29.610 |

The production alignment replay retained monotone aligned fractions, zero timing-anchor error at start/sectors/finish, and a +0.201 s finish delta. Sector differences are +0.050, +0.180 and −0.029 s, summing to +0.201 s. No alignment-model adjustment was needed or applied.

Both replayed laps had complete position coverage. Same-fraction positional separation was about 5.19 m median / 16.11 m P95 / 27.68 m maximum, including real racing-line differences and source sampling. These numbers are not a confidence interval or a claim of perfect physical co-location. The earlier browser comparison used mixed source availability; the saved replay used OpenF1 for both laps. It is inappropriate to force independent driver braking/speed features to coincide.

## Verification and boundaries

- 222 JavaScript tests passed.
- All Python regression scripts passed, including 12 new OpenF1 fallback/source/expiry/retry/upload tests.
- Production build succeeded; Vinext's existing route-classification advisory remains non-fatal.
- Production backend deployed and directly verified, not inferred from a Git push or local test.
- Browser Latest 3, fastest-lap comparison, wide driver rail, responsive reparenting, run-button sizing, header padding and summary divider checks completed.

This is a targeted correction, not certification that every event/provider combination or every element on every platform matches native Apple UI. Existing calculation eligibility was not weakened to manufacture coverage.
