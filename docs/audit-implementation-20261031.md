# Reliability and numerical audit implementation

## Scope and evidence

Baseline: published source b799735. Changes preserve native telemetry and keep
estimated alignment opt-in. Physics changes are limited to explicit unknown
aero-state strata, integration remainders, and exact per-lap minima reuse.
The method identifier is now speed-domain-v4-aero-unknown-integral.

The six-car, fixed-seed, known-aero synthetic fixture measured 178 ms -> 91 ms
median (five runs per implementation, same process). Results were identical
apart from the method identifier. Reproduce with:

    python scripts/benchmark-physics.py --baseline b799735

This does not establish a real-world vehicle-capability model or a 49% gain
in overall page loading. Provider delays and rendering are separate budgets.

## Changes

- Fresh qualifying requests refresh session/performance summaries before lap
  selection, while retaining complete same-lap telemetry and retrying gaps.
- Shared capture locking and atomic JSON replacement prevent torn indexes and
  capture/sync lost updates. Failed writes retain the previous complete index.
- Request budgets are enforced while reading streams, not only from headers.
  Global errors return opaque request IDs; logs retain details. CORS POST is
  restricted to the same approved origins as GET.
- Coverage headings count data usable by the displayed category. Parent DOM
  replacement explicitly unmounts React islands before removing their nodes.
- Snapshot compatibility is an explicit per-current-revision policy. Captures
  retain their original calculation revisions, including after index migration.
  Older snapshots are not promoted to live cache entries or new-model results.
- A read-only release gate checks every indexed gzip/JSON payload and revision.
- Python CI uses the existing uv.lock with frozen resolution. Dependencies are
  not inferred from whichever packages happen to be on the preparing PC.
- Targeted npm overrides update fflate and minimatch; validate with npm audit,
  typecheck, lint, unit tests, browser tests and a production build.

## Deliberately retained functionality

The second qualifying corner calculation remains: legacyTraces is consumed by
the UI's older-window comparison. Removing it would remove a working feature.
Further extraction of the large analysis modules is not a prerequisite for
correctness; shared security, persistence and revision policies are extracted
without rewriting validated numerical models.

## Release verification and recovery

Run npm run sync:apex, npm run release:check, npm test, npm run test:py,
npm run typecheck, npm run lint, npm run test:e2e and npm run build.
Loaded browser fixtures cover real saved qualifying laps, missing telemetry,
keyboard trace toggles, narrow containment and repeated React view navigation.
Shell tests isolate captured calendar indexes as well as live API responses.

Never delete an index.lock without first verifying its owning exporter has
stopped. Locks are not stolen by elapsed time: a slow valid export must not be
overwritten. All superseded data files are retained. To roll back production,
redeploy the previous saved Sites version rather than deleting PC data.

Historical snapshots retain their originally calculated values and provenance.
They are not claimed to have been reprocessed with v4. Future local calculations
use v4; unsupported observations remain missing or explicitly unknown.

## Verification limits on the preparing Windows PC

Chromium: 19 browser checks passed. WebKit: 17 passed, two Chromium-only
media-emulation checks skipped. Firefox could not launch: Windows returned
spawn UNKNOWN even for its --version command, before any application code ran.
The Linux CI Firefox job remains enabled; no test was disabled to hide this.
All 20 Python test files also passed in a fresh uv sync --frozen environment.
