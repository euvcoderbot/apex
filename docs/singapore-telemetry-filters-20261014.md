# Singapore straight and braking recovery — 14 October 2026

## Exact-source investigation

The published fastest-qualifying-lap batch had 10 measured teams, 50 braking intervals (15 supported, 35 provisional), no supported paired braking cohort and no settled-straight score. Aston Martin was excluded by the existing 3% timing-sector distance-registration gate. No corner-position cache or rendering change removed the raw measurements.

The read-only archive replay reproduced those counts from `load_selected_laps_telemetry`, using the same exact fastest-lap selection as the live API. Separate OpenF1/native telemetry replays were not substituted for this exact-source check.

Straight blocks were already outside corner envelopes. A second fixed 200 m entry / 100 m exit trim left only 35 m over all six Singapore links; the continuous-100 m and aggregate-200 m requirements could never pass. Length-aware additional buffers (20% at entry, capped at 200 m; 10% at exit, capped at 100 m) preserve long-straight rules while retaining shorter links. Full throttle, no brake, low curvature, matched DRS, source gaps ≤0.6 s, continuous windows ≥100 m and total ≥200 m remain required. The full-field common result measures approximately 290.072 m, not every metre on the straights.

Braking endpoint choice previously maximised the initial field and speed drop before checking native timing support. Narrow shared drops could leave the entire field provisional. Candidate endpoints now prioritise a supported paired quorum, then supported sample count and field coverage. Interior-sample, original endpoint-bracket, speed monotonicity, source-gap and physical-deceleration gates are unchanged. Both paired timing metrics still use identical actual source laps and rows. Slower/repeat laps are not used to rescue a missing fastest lap.

Independent slowing now connects all supported overlapping zones, instead of selecting an unnecessarily small complete rectangle. It explicitly does not require or invent an approach score. The strict paired rectangle remains available separately. Empty ranking cohorts are distinguished from measured braking evidence; straight exclusions have an explicit source reason.

## Verified results

The separate Vercel API was successfully deployed to its existing production alias `https://apex-telemetry-api.vercel.app`. Live responses, not just local calculations, returned `qualifying-braking-v4-supported-endpoints` and the length-aware straight method.

| Singapore view | Settled-straight scores | Supported paired braking | Connected independent slowing |
| --- | ---: | ---: | ---: |
| Teams | 10 / 11 | 7 / 11 over 4 zones | 9 / 11 over 6 zones |
| Drivers | 17 / 21 | 12 / 21 over 4 zones | 17 / 21 over 5 zones |

Team source: 44 observed intervals, 35 supported, 15 with supported approach timing. Driver source: 60 observed intervals, 48 supported. ALO/STR fail sector-distance registration; COL fails frozen-speed / time-agreement checks in driver mode. Other unranked entries lack sufficient shared native evidence; their available measurements remain visible.

The Sepang exact archive replay retains all 11 straight scores and 36 supported braking intervals. Long-straight, low-curvature, aero-state mismatch, sparse-source, fastest-lap identity and paired-coverage tests pass. Automated checks: 149 JavaScript tests and 87 Python tests passed (each hyphenated Python test script executed directly; unittest discovery would skip them).

Derived backend cache identity changes with this method revision; existing source telemetry caches remain valid. Browser visual QA is unverified; live API and frontend-calculation replays establish the reported coverage, not a fresh screenshot check.

## Reproduction

`scripts/capture-metric-replay.mjs` captures exact requested native laps for team or driver scope. `scripts/audit-singapore-filters.py --archive` replays the actual selected-lap archive and writes generated audit data outside the checkout. `--saved-archive` reuses that capture. `scripts/verify-live-metric-support.mjs` verifies the deployed API and the dashboard's real comparison functions. These scripts do not mutate dashboard source data.
