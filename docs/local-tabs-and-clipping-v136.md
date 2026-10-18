# Local tab lifecycle and status clipping — v136

## Close the tab, stop local compute

Every local dashboard document owns a same-origin live connection. Closing its tab closes that connection even when the in-app browser does not deliver `pagehide` or an unload beacon. The server counts active local dashboard tabs and stops after the last connection closes, with a five-second grace for reloads/navigation. Closing one of two tabs does not stop the other. Reload opens a replacement connection within that grace.

Shutdown closes the local HTTP server and the owned Python process tree. On Windows the virtual-environment Python launcher can own another Python process, so killing only its immediate PID was insufficient. Shutdown now targets that specific spawned tree, not all Python processes or an arbitrary port owner. Disk caches remain intact.

Background tabs retain their connection, and a sleep/timer clock jump does not expire an open connection. A heartbeat/beacon fallback exists for older clients without EventSource, with a three-minute missing-heartbeat timeout. A launcher that never opens a dashboard stops after one minute. Development-only persistent runs can opt out with `APEX_LOCAL_KEEP_ALIVE=1`.

This applies to local dashboard tabs, not the published website sitting elsewhere. A published tab cannot close another tab's local compute while that local dashboard is still being used.

## Local-compute button

The primary action now targets the local HTTP dashboard, not a silent custom-protocol navigation. It performs read-only health discovery and opens the running dashboard in the same tab. If discovery cannot reach it, a native dialog explains the startup handoff and provides an explicit local-dashboard link. It no longer silently pretends to start a server.

The Codex in-app browser blocks launching local programs. Website code cannot safely override that restriction. Starting a stopped server from that browser remains an app-level limitation; the existing installed Windows launcher is retained as an explicit manual action for browsers that support it. No hidden frame, automatic scheme redirect or security-policy bypass was added. The fixed published origin can read only local health status; lease changes and calculations remain same-origin and reject cross-site requests.

## Clipping

The authoritative status-message rule now supplies 8 px vertical / 12 px horizontal padding, natural height, bounded width and normal wrapping. This fixes text touching the accent border and wrapping outside its container. The exact loading message is included in the component catalogue as a regression fixture.

## Verification

- Actual in-app browser tabs: two leases registered; closing one and reloading the other left exactly one active lease; closing the last stopped both dashboard and Python listeners.
- Independent full-process replay: first-tab close and reload survived; last-tab close stopped both listeners after about 5.5 s and the runner exited successfully.
- Exact loading-text bounds were inside the message container, without overflow, at 1280, 768 and 390 px. The message occupied one, two and three lines respectively.
- Unit tests cover multiple tabs, reload grace, missing-heartbeat fallback, sleep/background transport, transport disconnect without an unload event, same-origin enforcement, and owned Windows process-tree termination.
- Local navigation cannot bypass an external-app or private-network permission. Those browser-dependent restrictions remain explicit rather than being described as working startup.
