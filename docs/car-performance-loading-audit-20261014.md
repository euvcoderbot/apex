# Car-performance loading and coverage audit — 14 October 2026

## Observed bottlenecks

- Published 2026 Sepang qualifying and race summaries each contained 11 teams. Read-only HTTP probes returned cache hits but took 4.31–4.57 seconds from this machine. The payloads were 46,901 and 98,177 characters; qualifying advertised 53 candidate laps.
- The client ignored the server's result lifetime, retaining every current-season result for just 120 seconds. A frontend presentation change also invalidated raw source responses.
- A qualifying batch with one excluded entrant could not enter the durable cache, even if the other ten had usable data. Reopening a category could repeat a slow source calculation.
- Straight-line and braking loading used different batches: all candidate laps versus exact fastest laps. Corners downloaded native lap arrays and recalculated circuit windows in every browser session.
- Category loading waited for all qualifying/race summary jobs. The straight loader also reused, and aborted, the summary request controller.
- Race snapshot calls independently repeated race-cohort selection. Selected rows included entire driver lap lists. The browser repeated the selection as well.
- A long gap anywhere in a lap excluded every corner. Unknown speed classification at one turn vetoed unrelated classified bands.
- Braking's strict complete rectangle retained five teams in the captured Sepang case, despite eleven measured entrants. Filtering chart inputs removed unranked entrants visually.

## Implemented architecture

1. Separate source, upstream calculation and measured-result versions. UI asset hashes change on deployment without discarding unchanged raw-data caches.
2. Honor the server's remaining TTL in browser memory/IndexedDB. Recent results retain 120-second correction checks; older completed current-season events cache for 30 days, historical results server-side for one year. Browser retention is capped at 30 days. Explicit Refresh and methodology keys invalidate results.
3. Cache usable partial batches for 120 seconds, including their exclusion reasons. Empty/error-only responses are not cached.
4. Bound concurrent upstream retrieval to six requests per cache instance and estimated retained payload memory to 32 MB / 128 entries. Background race telemetry can occupy at most four slots, leaving foreground capacity; queued summary/batch retrieval has priority. Cache hits bypass the upstream queue.
5. Start the selected telemetry category as soon as its event summary arrives. Independent controllers preserve ongoing summary retrieval; generation-scoped attempts prevent automatic retry loops.
6. Use the same exact-fastest-lap batch for team straight-line and braking analysis. In the Sepang input this reduces 53 candidate windows to 11 selected laps, matching the requested fastest-qualifying-lap scope. Repeated laps are not extra evidence in these comparisons.
7. Add `/api/qualifying-corners`: coalesced, durable server-side corner measurements. Return selected-lap identities, measurements and exclusions, not native sample arrays. Manual retry refreshes only incomplete native laps.
8. Cache compact race-selection plans once per GP and subject. Each snapshot reuses the plan. The browser receives the selected groups rather than every driver's full lap list.
9. Use binary searches for corner boundary and classification lookup. A gap excludes only its affected windows. Require valid monotonic timing, official sector consistency and supported local brackets; never bridge a local interval above 1.5 seconds.
10. Compare partial race-corner support in blocks with identical measured corners. Native blocks expand to unique physical lap-pair/corner contrasts so overlapping cohorts do not count the same turns twice; disconnected groups cannot share a ranking zero.
11. Add matched measured qualifying corners (estimated average seconds per corner), retaining the complete-total view separately. Missing corners are not filled or extrapolated to a whole-lap loss.
12. Add connected paired braking (estimated through overlapping rivals), retaining strict complete rectangles and independent slowing. Both paired metrics consume the same actual supported rows. Missing comparable approach boundaries remain unranked.
13. Retain unranked entrants in chart inputs and tables, with no zero score.
14. Check for eligible race jobs before entering loading state. Empty or already-attempted automatic queues return without rendering or recursively restarting the loader.

## Verification

- Regression tests cover partial-batch reuse across cache instances, TTL expiry, concurrency, server measurement coalescing, targeted retry, compact race plans, local-gap retention, immutable lap identity, chart visibility, and independent request controllers.
- Captured Sepang braking: strict paired ranking supports five teams; connected paired ranking supports seven; independent slowing supports ten. All eleven received entrants remain in the measurement rows. Red Bull's absent comparable approach measurement is not fabricated.
- The connected paired event calculation took approximately 3.2 ms in the local diagnostic replay. This is not an end-to-end page-load benchmark; it cannot be compared directly to localhost warm-cache timings as a claimed speedup.
- Local browser verification showed all 11 teams ranked for Sepang qualifying cornering, including all five classified high-speed turns. Race cornering also reached 11 connected teams while continuing to collect repeat snapshots. A subsequent empty-queue retry caused a stack overflow; this was fixed and covered by a regression test. The final browser recheck was blocked by browser security policy, so the final fix is test-verified, not claimed as a fresh visual verification.
- Final regression run: 143 tests passed, none failed or skipped.

## Remaining limits

- A first uncached source retrieval or explicit refresh can still be slow. Race cornering needs multiple physical laps and can continue gathering repeat evidence after the full field appears. Caching does not make unavailable upstream telemetry appear.
- The separate upstream Python service retains responsibility for acceleration, straight and braking extraction. This release does not claim to have changed or redeployed that service's methodology.
- Connected rankings are estimates through shared rivals, not a direct complete-field test. Conditions, tyre-age matching and fastest-lap selection remain explicit. Unsupported teams/windows stay visible, not invented.
- No Rust rewrite was performed: the measured replay calculations took milliseconds, while observed cached network requests took seconds. Rewriting that calculation alone would not address the dominant measured delays.
