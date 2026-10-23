# On-demand local compute

The installed Windows launcher starts a loopback-only dashboard and Python API.
It stays ready after tabs close, until explicitly stopped or Windows shuts down.
It does not compute continuously, open a public port, or install a login task.
`start-local.cmd` / `npm run local` use the same persistent behaviour, managed by
their terminal. Set `APEX_LOCAL_KEEP_ALIVE=0` explicitly for tab-scoped test sessions.

The public page checks whether the companion is already healthy and reuses it,
preserving the current view, season, session and comparison URL. Choosing
“Use hosted site” opts out of automatic local routing in that browser. Clicking
“Use local compute” opts back in. The explicit Windows launch link still needs
browser approval; the Codex in-app browser cannot launch installed programs.

Local mode requests Python on demand instead of preferring published snapshots.
Disk and short-lived browser caches avoid repeated downloads. No export or Site
publication is required to view newly fetched local results. Source limits,
network failures, unsupported laps and unpublished observations remain real
constraints; local compute does not invent missing data or bypass paid feeds.

`local_api.py` is the local service entrypoint. It handles practice timing
directly with the shared OpenF1 timing parser, including recent sessions when
the timing archive is unavailable. Every other route mounts the shared backend
(native telemetry, performance, calendars). Keeping this adapter separate leaves
the hosted source/calculation revisions and existing season exports intact.
Local disk response caches use `dashboard-local-v2`; raw source caches are reused.

Click “Local compute” (with the green status dot) for status/options. “Stop local compute” is a
same-origin POST action; public sites can only read health, not stop the service.
The launcher safely coalesces repeated starts and verifies Python readiness.
