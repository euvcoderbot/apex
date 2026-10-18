# One-click local compute — v134

Superseded for the website button and shutdown behavior by [v136](local-tabs-and-clipping-v136.md). The installed Windows launcher remains available; the Codex in-app browser cannot activate it. Local tabs now automatically stop compute when the last one closes.

The published **Use local compute** action now activates `apex-local://start`, rather than navigating to a server that might not be running.

The Windows launcher is registered for the current user on this PC. Clicking the button starts the local Node dashboard and Python parser in the background, waits for the readiness response, and opens `http://127.0.0.1:54123/apex/` in the default browser. A running server is reused; repeated or simultaneous clicks do not intentionally start duplicate parsers. Local mode still routes calculations directly to Python on this PC, never Vercel, and preserves its disk caches.

The browser may require its normal external-application confirmation. That security prompt cannot safely be suppressed by the website. Some embedded browsers do not support external application links; use the published Site in a normal Windows browser in that case.

## Installation and scope

This PC has already been configured. No manual server startup is required after a reboot: click the button again. On another Windows PC, install the existing project dependencies/Python environment and run `install-local-launcher.cmd` once. If the checkout moves, rerun the installer from its new location after removing the obsolete registration. This is not a remotely installed app; the hosted page cannot execute arbitrary programs on an unconfigured computer.

The handler is under `HKCU\Software\Classes\apex-local`. It accepts only the exact start action. No website-supplied command, executable path, destination URL or shell expression is executed. The existing windowless Python runtime passes a fixed action to Node, and all background processes are hidden. No administrator access, startup task, firewall change, public listener, execution-policy bypass or persistent browser extension is added. Existing unrelated protocol handlers are not overwritten.

Logs live under `.apex-cache/launcher/`: `server.log` for compute startup and `launcher.log` for readiness/reuse/failure. Only the explicit local start action is registered; this does not create a general localhost command API.

## Verification

- A stopped local server was started by the actual launcher entrypoint without manually invoking the server runner.
- The first activation recorded `reused:false`; the second recorded `reused:true`.
- The actual Windows windowless Python entrypoint ran successfully with browser opening suppressed for headless verification. A PowerShell wrapper was rejected during development and removed; no execution policy was changed.
- The local readiness endpoint reported Python on this machine and a loopback-only backend.
- Tests cover cold/warm starts, readiness timeout, spoofed status, rejected URI/argument injection and per-user hidden registration.
- Default-browser opening and a browser's external-protocol confirmation depend on Windows/browser support; headless verification does not certify those prompts in every browser.
