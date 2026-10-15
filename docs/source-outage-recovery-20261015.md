# Source outage recovery — 15 October 2026

The published Singapore qualifying summary returned HTTP 422. Its direct telemetry-API
request reproduced the failure. Locally, the same load had no `data.laps`: the primary
FastF1 timing archive refused access and the mirror returned 404 for the exact 2026
Singapore qualifying path. Classification metadata alone did not constitute loaded laps.
The previous release verification did not cover this subsequent uncached source outage.

The repair separates retained source observations from calculated scores:

- Four already-captured, complete Singapore/Sepang Q/R session inputs are retained in a
  compressed read-only bundle, with input hashes and their **original**, unrenewed expiry.
  Exact original capture timestamps were not recorded and are left unknown.
- All current calculations rerun from those input lap records. No old v8/v111 performance
  scores are relabelled as v12. Missing freshness, weather, trap speeds and other fields
  remain unknown; they cannot enable unsupported diagnostics.
- The available 21 Singapore and 11 Sepang exact qualifying-lap recordings are also
  recoverable. Year, event, driver, lap, duration and requested session-clock boundaries
  must match. No alternate lap or previous year's circuit is substituted.
- Explicit refresh attempts the live source. If it fails, recorded summary/session inputs
  remain available with `refresh_failed` provenance. Non-recorded laps still need a real
  source; the recording bundle is not full-race telemetry coverage.
- Format-compatible v112 session/native cache entries can migrate without extending expiry.
  Calculated performance scores cannot cross methodology versions via this migration.
- The dashboard labels recorded inputs. If every session truly fails, the empty screen now
  retains the errors and retry direction instead of returning to “Ready for analysis”.

Tests cover exact identity, expiry, immutable source inputs, live-refresh failure,
current-model recomputation, 11-team batch recovery and source-only cache migration.
The large raw inputs are mechanically packaged by `scripts/capture-source-recordings.py`;
they are public-source recordings retained during this task, not synthetic lap times.
