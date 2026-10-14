# Pit timing coverage — 14 October 2026

The initial production Singapore response used FastF1: 25 valid pit-lane visits, all stationary durations null. DHL publishes 25 driver/lap timings for the same 11 October event. Enrichment ran only on the OpenF1 branch, so a transient OpenF1 failure discarded a separately available stationary source.

The FastF1 fallback now performs the same race-date, driver-identity and exact in-lap match. Existing native stationary values are not overwritten. A published stationary-only visit is retained even if lane entry/exit telemetry is absent; its lane duration remains null. OpenF1 stationary-only records receive the same treatment. No pit-lane time is converted into a box-stop estimate and no neighbouring lap is guessed.

The payload includes timing counts, complete/partial/unavailable status, supplement availability, race date and lightweight entrants. Team/driver display no longer depends on loading unrelated race-pace results. Entrants with no recorded visit remain visible without a zero-second statistic.

Partial or missing stationary responses revalidate in the shared cache after 300 seconds, including past completed races; empty responses are not durably cached. Complete old results retain the normal stable-event lifetime, keyed by source/method revision. Manual Refresh missing timing clears the incomplete in-page result and explicitly bypasses the shared cache. Source query/schema revision prevents reuse of the old pit payload. Spread and percentile table blanks explain the required sample count (4 for P25–P75 spread, 10 for P10/P90), rather than pretending one visit measures consistency.

## Verification

The deployed API returned Singapore with 25/25 stationary timings, covering 11 teams and 20 drivers who pitted. Fastest: VER L32, 2.200 s. Exact DHL timings and driver/lap identities are checked by `scripts/verify-pit-coverage.py`; lane and stationary values remain separate. The FastF1 enrichment path, stationary-only records, duplicate protection, partial-cache TTL, chart/table statistics and entrants without stops have regression tests.

Cross-GP replay: Sepang (the API's 2026 Bahrain label) returned 72 published timings among 73 lane visits, all 11 teams / 21 drivers; Baku returned all 21 published timings among 36 lane visits, 10 teams / 19 drivers. The unmatched lane visits are retained without invented stationary values. Both upstream HTTP and shared-cache TTLs cap incomplete responses at 300 seconds.

Published source: [DHL Fastest Pit Stop Award](https://inmotion.dhl/en/formula-1/fastest-pit-stop-award), event 1184. Its 2-decimal published values are displayed to the dashboard's standard 3 decimals; this does not imply millisecond source precision. Historic years outside the existing 2026 DHL integration do not acquire invented stationary data.

Browser visual QA remains unverified; automated rendering-function tests, local HTTP availability and production API checks are verified.
