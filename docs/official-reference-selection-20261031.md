# Official-timing reference selection

Implemented locally after user approval on 31 October 2026. No push, merge or deployment.

## Verified defect

The v4 speed-domain model chose its reference geometry using the elapsed time
between the first and last telemetry packets. This is not an official lap time.
The Madrid recording contains:

| Driver | Lap | Official time | Packet span |
|---|---:|---:|---:|
| Norris | 18 | 91.824 s | 91.40000009536743 s |
| Leclerc | 20 | 92.019 s | 91.40000009536743 s |

The equal packet spans made the selected reference depend on driver-list order.
Reversing the input changed, for example, Norris's traction gap from 3.909124%
to 1.141802%. Those are model-derived comparisons, not measured car capability.
This was not merely round-off: straight/exit sample counts and corner geometry
also changed. Other fixtures exhibited only floating-point reduction noise.

## Correction and limits

- Both production adapters now pass the validated official time and session-clock
  completion time alongside each lap's unmodified native sample array.
- The fastest eligible official lap supplies the reference. For identical official
  times, the earliest completion wins when all tied candidates have that clock.
- If chronology is missing, a deterministic identity tie-break is explicitly
  disclosed as `stable-identity-chronology-unavailable`. It does not claim the
  correct official classification order. Lap numbers across drivers are not a clock.
- Direct callers without official timing retain an explicitly labelled packet-span
  fallback, with deterministic tie resolution. Production adapters supply official times.
- No raw channel, position alignment, physics equation, or telemetry timestamp is
  shifted or repaired by this change. Existing eligibility filters remain unchanged.
- Method changes to `speed-domain-v5-official-reference`; the generated backend
  identity changes. v4 results are not migrated into the current live result cache.
- Historical snapshot files and their original revision tags are preserved. The
  publication policy permits displaying them as retained historical methodology,
  not freshly recalculated v5 results. Rebuilding all historical metrics is separate.

## Verification

`scripts/test-recorded-physics.py` verifies official time beats packet coverage,
earliest completion resolves real ties, missing chronology is disclosed, and the
production adapter retains timing metadata. It also checks dimensional correctness
of the constant-acceleration integral against an independent analytic solution.

The offline corpus covers 34 recorded qualifying sessions, 1,376 laps and 676
supported driver-session outputs. Reversing the driver order now leaves all public
outputs equivalent within 1e-10 tolerance; the largest observed numeric difference
was 8.881784197001252e-14. Madrid consistently selects Norris. All five new tests
and all 26 existing physics tests passed.

Corpus SHA-256 (sorted compressed files):
`6e06f884740f6e7bf701f7c0b6e8684bac12ca81bfb2eaec4dd6ef0106060a7e`.

Recorded packet span versus official lap duration differs by a median 0.281 s,
p95 0.58725 s, maximum 1.924 s. This diagnoses endpoint coverage; it is not a
justification to shift traces. The corpus lacks absolute lap-completion timestamps,
so real chronological ties are tested with a controlled fixture, not claimed as
validated from those recordings. Finite and order-independent outputs are not
proof of isolated grip, power, braking hardware or lap-alignment accuracy.
