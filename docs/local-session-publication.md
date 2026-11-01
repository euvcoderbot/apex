# Publish a new completed session using local compute

The public site reads locally prepared timing, native telemetry, and supported
performance/corner measurements without a hosted telemetry API. These are
captured snapshots, not live streaming. The PC scheduler prepares data; the
separate Codex publication automation validates and publishes prepared assets.

The installed session scheduler stages validated prepared data into the current
Site checkout (`site-claude-latest-release` alongside the local preparing checkout) after
each exported session and on recovery runs. Set `APEX_SITE_CHECKOUT` if the
checkout moves. Staging does not build or publish the Site; use the Sites
release workflow to make changes visible to visitors. Failed preparation or
sync is logged to `~/apex-data/session-archive.log` and retried. Machine-readable
health is written to `~/apex-data/openf1/pipeline-health.json`. Failed or partial
preparation exits nonzero; an overlapping job does not overwrite the owner's
health report. The publisher checks health before declaring no new work.

Start the local server from this checkout, then prepare a completed qualifying:

```powershell
npm run site:prepare -- --year 2026 --gp "United States Grand Prix" --round 18
```

Add `--race` once the source calendar confirms the race completed; this also
captures race sessions and matched race-corner groups. Unsupported windows and
incomplete groups remain unavailable, never substituted with zeros. Add
`--refresh` to recapture raw streams after source corrections. The command
checks that the local server and checkout have matching calculation revisions.
It prepares files only: a separate validated Sites release publishes them.

From the project checkout, with the existing Python environment installed:

```powershell
npm run local:export-session -- --year 2026 --gp "United States Grand Prix" --round 18 --session "Practice 1"
```

The command confirms the exact source session and its published classification,
uses the backend's OpenF1 parser on this PC, captures all drivers' raw streams,
and exports native lap packs using the existing reconstruction. It also updates
the saved calendar and warms the local API's session-summary cache. It never
depends on the unavailable official timing archive or Vercel.

Existing exports are merged, not cleared. Sessions inside the six-hour source
correction window carry `local_export.provisional: true` and a capture timestamp.
Live, future, cancelled and unconfirmed sessions are rejected. Unsupported lap
boundaries are reported and not invented. A partial session can publish its
supported native laps without discarding other drivers: `lap_data_complete`,
per-driver `missing_laps`, `telemetry_complete`, and `telemetry_missing_laps`
disclose the gaps. Individual timed laps carry `telemetry_available`. A session
with no supported native timed laps is rejected. Partial sessions remain
retryable, and their official completion status is independent of export
readiness. Timing-row retries bypass a stale settled cache without downloading
all telemetry again.

Open snapshot pages revalidate availability every minute while visible and
invalidate cached indexes when returning to the page. Newly published sessions
become selectable without clearing an existing comparison. All publication
still requires an awake PC, the app, and Sites access.

To incorporate later timing corrections, rerun with `--refresh`; otherwise raw
streams already captured on disk are reused so interrupted downloads can resume.
Build, validate and publish the resulting assets through the normal Sites
workflow to update the public site. Pre-rendering merges compatible files and
refuses to overwrite a revision mismatch rather than clearing older exports.

The retained historical index keeps its original source and methodology
revisions. The site recognizes the specifically audited migration from the old
in-repository OpenF1 raw location to the durable raw archive; this changes
storage location, not captured packet bytes or calculation formulas. Other
revision pairs are not implicitly treated as compatible.
