# Cornering audit — 21 October 2026

This supersedes the corner-timing score in `speed-domain-methodology-20261020.md`.
The older straight-line/braking validation is unchanged; its teammate-agreement
benchmarks must not be attributed to this revised corner estimator.

## What was wrong

The previous score timed each car's timestamps between shared GPS-projected
lines, then added a modelled entry-speed correction and credited exit speed
over up to 500 m of the following straight. A changing GPS/odometer residual
changes the car's native distance between those shared lines. At 200 km/h,
3 m is approximately 0.054 s: material compared with the differences displayed.
The exit credit was hypothetical time outside the actual corner window.

In the retained 2026 Bahrain-labelled/Sepang qualifying feed, HAD L8 (1:35.558)
and VER L11 (1:35.130), the previous medium-speed result favoured HAD by
0.159835 s (1.665 percentage points of *medium-corner time*, not lap time).
It did not correspond to an equally large difference in their speed traces.

| Medium section | Shared start/end (m) | Previous score HAD−VER | New common-distance estimate HAD−VER |
| --- | --- | --- | --- |
| T7 | 2398.893–2696.713 | −0.140809 s | −0.072960 s |
| T11 | 3317.961–3553.699 | −0.019026 s | +0.033151 s |
| Total | Two sections | −0.159835 s | −0.039810 s |

Negative favours HAD. At T7 both have a sampled minimum of 192 km/h. Approximately
0.062 s of HAD's new 0.073 s advantage is in the shared exit phase, after the
2555 m apex line; entry/exit speeds are roughly 260/242 vs 261/240 km/h.
T11 favours VER despite both recording a 150 km/h minimum. A minimum speed
alone therefore does not establish who covered a section more quickly.

Low-speed total: HAD is approximately 0.434 s slower (previously 0.590 s).
High-speed total: HAD is approximately 0.061 s slower (previously 0.108 s).
The T5–T6 complex supplies that high-speed difference. Flat T12 supplies no
HAD/VER separation under the retained flat-bend diagnostic rule.

These are qualifying-lap observations, not assertions about either driver's
intrinsic ability. No ranking or team identity is an input to the estimator.

## Revised estimator and limitations

`speed-domain-v3-trace-integral` / `car-measurements-v18-trace-integral`:

1. Keep the field-defined shared corner lines and brake-release/apex phase lines.
2. Integrate each car's measured speed over the same path: integral(ds/v).
   Speed squared is linear in distance between packets (constant acceleration);
   each clipped interval takes `2 * distance / (v_left + v_right)`.
3. Do not add entry corrections or following-straight exit credits to this score.
   Their former values and raw timestamp timing remain diagnostic API fields.
4. Do not scale a partial set of corners up to a complete band. Every ranked
   entrant must cover all supported corner sections in that band; measured
   partial sections remain available in the detailed evidence.
5. Publish maximum source gaps and sensitivity to shifting the car's registration
   by ±5 m. This sensitivity is a disclosed scenario, **not** a confidence interval
   or a comprehensive error bound. Gaps >0.6 s are visibly provisional; >1.5 s
   remove the affected corner. Only intervals intersecting the window count.

The common-path assumption removes GPS-derived local path-length stretch, but
also does not measure genuine racing-line length differences. Registration still
affects where speed features lie. There is no high-rate ground truth here.
Power, driver, setup, tyres, conditions and approach speed can still influence
the observed trace: this is delivered corner-section performance, not isolated
grip. Coarse sampling can miss an apex speed trough entirely. Small numerical
advantages are not proof of a real or repeatable advantage.

High-load flat bends retain Claude's conservative lifting diagnostic: cars that
stay flat are not ranked by power-driven speed differences. If everyone stays
flat (or no flat reference exists), the bend contributes no grip comparison.
T5–T6 remain detected; empty high-speed bands at other circuits are not filled
with artificial corners or zeros. The low/medium/high thresholds remain shared
field minima of ≤120 / 120–200 / >200 km/h, not individual classifications.

## Reproduction and checks

`scripts/audit-corner-comparison.py` can capture native inputs through the same
backend pipeline, then replay them without another source download:

```text
python scripts/audit-corner-comparison.py --year 2026 --gp "Bahrain Grand Prix" --drivers HAD VER --capture inputs.json.gz --output audit.json
python scripts/audit-corner-comparison.py --input inputs.json.gz --output replay.json
```

The report includes per-corner estimates, raw timing, phase gaps, native-path
distance, speed-integral checks, source gaps and source lap selections. Raw feed
captures are local audit artifacts, not a newly bundled historical database.

Known-truth tests cover exact constant-acceleration integration, identical speeds
under a warped GPS path, phase additivity, dense-sample agreement, explicit
provisional status for long gaps, full-band coverage, and preservation of grip,
braking and straight-line signals in the point-mass simulator. The prior claim
that sparse 1.1 s speed sampling stays accurate to 0.05 s is deliberately removed:
it is not supportable when a gap misses a speed trough. Sparse estimates remain
visible, but are flagged instead of promising that accuracy.
