# Publish a new completed session using local compute

The public site reads locally prepared timing, native telemetry, and supported
performance/corner measurements without a hosted telemetry API. These are
captured snapshots, not live streaming or an automatic publication job.

The installed session scheduler stages validated prepared data into the current
Site checkout (`site-claude-oct31` alongside the local preparing checkout) after
each exported session and on recovery runs. Set `APEX_SITE_CHECKOUT` if the
checkout moves. Staging does not build or publish the Site; use the Sites
release workflow to make changes visible to visitors. Failed preparation or
sync is logged to `~/apex-data/session-archive.log` and retried.

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
boundaries are reported and not invented; every driver's fastest timed lap must
have a supported trace before the command reports success.

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
