# Publish a new completed session using local compute

The public site can read exported timing and native telemetry files even when
the hosted telemetry API is unavailable. This is a captured snapshot, not live
streaming or an automatic recurring job.

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
workflow to update the public site. Do not run the full-season `prerender`
command for this update: it clears exports before rebuilding them.
