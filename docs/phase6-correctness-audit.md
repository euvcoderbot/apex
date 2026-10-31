# Phase 6: correctness and numerical audit

Scope: whether the numerical core and the loading state behave correctly on bad input and across the whole 2026 season, without
changing any physics. Method, what was found, what was fixed, and what was not looked at.

## Method

1. **Coverage** of the numerical modules by the existing tests (Python `coverage`, Node `--experimental-test-coverage`).
2. **Adversarial inputs** (`python scripts/audit-numeric.py`): empty, one-sample, duplicate, backwards and constant time; NaN and
   infinity; negative, huge and wrongly-scaled speeds; degenerate regressions; missing keys. It reports what raises and what
   returns a non-finite number. Each report is then traced to its production call sites to see whether the input can reach it.
3. **Season plausibility**: every Qualifying and Race result for rounds 1 to 18 of 2026 from the running API (36 sessions).
4. **Stale responses**: a slow answer to an earlier session request, with the later request answered first.

## Coverage

| Module | Line coverage |
|---|---|
| `car_physics.py` | 94% |
| `pace_models.py`, `openf1_performance.py` | 95%, 97% |
| `performance_tracks.py` | 89% |
| `performance.py` | 83% (uncovered lines are mostly guard clauses and the traffic helpers) |
| `session_loader.py` | 27% (network code) |
| `speed-domain.js`, `telemetry-model.js`, `corner-position.js` | 100% |
| `race-cornering.js`, `corner-geometry.js` | 89%, 89% |

`alignment.js` runs under a script harness, so Node cannot attribute coverage to it; it is not measured.

## Season plausibility (36 sessions)

All 18 rounds return a result for both sessions with 11 teams each. No NaN or infinity anywhere in the responses. For every
Qualifying result: exactly one reference team has zero pace deficit; no ideal lap is slower than the complete lap; each ideal lap
equals the sum of its sectors to 2 ms; every deficit is positive when its seconds are; deficits run 3.6% to 5.8% of lap time;
ideal lap times are 66 s to 104 s. No inconsistency found.

## Findings

| # | Finding | Reachable | Action |
|---|---|---|---|
| 1 | `speedDomainPhases` counted a missing braking, mid-corner or exit phase as zero seconds: a `null` phase became 0, so that team appeared to match the field median. NaN was handled (shown as unavailable), `null` was not. | Only if the API sends a null phase; the Python side computes floats, but a NaN serialised to null would do it | **Fixed**: a team is in the breakdown only with all three phases finite. Regression test. |
| 2 | `acceleration_index` with neither `v_end` nor `distance_m` raised an unhelpful `TypeError`. | No: both production call sites pass exactly one | **Fixed**: raises `ValueError` saying what is needed. Regression test. |
| 3 | `simulate_straight` raises `IndexError` when no node of the curve is finite. | No: the caller requires a finite node and at least three supported nodes first | Not changed. |
| 4 | `robust_fit` and `tyre_curve` return NaN, and `huber_fit` raises `LinAlgError`, for non-finite input; inconsistent. | No: laps pass through `number()`, which drops non-finite values, before any fit | Not changed. Recommend one precondition (`ValueError` naming the bad column) if these functions are ever called from a new path. |
| 5 | `performance.number(True)` returns `1.0`. | Unlikely: no caller passes a boolean field | Not changed; noted. |
| 6 | NaN in `local_slope`, `acceleration_curve`, `speed_since_minimum` outputs. | By design: NaN means "not enough support here", and every consumer treats it that way | None. |
| 7 | A speed series in m/s read as km/h produces numbers without error at function level. | No: `performance_tracks.prepare` rejects any lap with a sample under 30 km/h or over 420 km/h, which a m/s series would trip | None. |
| 8 | A late answer to an earlier session request could replace the later one. | Guarded: the previous request is aborted and the result is re-checked after each await | Confirmed by a browser test (the late answer arrives and is ignored). A control that removes only the second guard still passes, because the abort alone prevents it; the two are redundant, not the test. |

## Not audited

- The validity of the physics models themselves (corner timing, straight simulation, tyre curves). Their methodology and validation
  are in `docs/speed-domain-methodology-20261020.md`, `docs/speed-domain-validation-20261020.json` and
  `docs/tyre-trend-methodology.md`; this audit did not repeat that.
- Telemetry batch outputs (`trace-batch`), which need heavy telemetry calls, and `alignment.js` (estimated distance alignment).
- The network paths in `session_loader.py` (27% covered) beyond the retention and retry behaviour already fixed.
- Behaviour under real rate limiting at scale.
