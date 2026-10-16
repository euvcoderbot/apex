# Local compute, compact UI and Singapore straight correction

## Run analysis on this PC — no Vercel compute

Double-click `start-local.cmd` in the project folder, or run:

```sh
npm run local
```

Open **http://127.0.0.1:54123/apex/**. The green **Local compute · disk cache** status confirms local mode. The published Site also has a **Use local compute** link, but a browser cannot launch a Python service automatically; start the launcher first.

The local runner starts Python on `127.0.0.1:8000`, serves the same UI and API facade on `127.0.0.1:54123`, and routes parsing/calculations exclusively to that local Python process. There is no Vercel fallback in local mode. Direct source downloads (FastF1/OpenF1 and optional MultiViewer circuit metadata) still need internet access when missing from cache and remain subject to their own limits. No paid plan, public tunnel, system-startup task or publicly exposed listener was added.

### Persistent cache

- `.fastf1-cache/`: source timing/parser cache.
- `.apex-cache/`: prepared Python responses and downloaded race streams.
- `.apex-cache/dashboard/`: versioned dashboard responses, measured corner snapshots and derived performance batches.

These caches survive browser closes and service restarts. Concurrent identical requests coalesce. Writes are atomic. Completed event results reuse their original expiry; errors do not become durable results. Changed parser/calculation code changes the relevant cache key. UI-only changes do not invalidate raw sources. **Refresh data** explicitly refreshes selected calculations. Nothing blindly clears the entire cache on startup.

Stop the runner with Ctrl+C in its terminal; both owned services stop but the disk cache remains. Ports can be configured with `APEX_LOCAL_PORT` and `APEX_LOCAL_API_PORT`. The default link in the published Site uses port 54123.

### Precompute before opening categories

With the runner started:

```sh
npm run local:precompute -- --year 2026 --gp "Singapore Grand Prix"
npm run local:precompute -- --year 2026 --gp "Singapore Grand Prix" --race
```

This warms qualifying/race summaries, exact-fastest team and driver telemetry, qualifying corners, pit visits and sprint classifications. `--race` also completes every planned race-corner cohort, preserving already-computed work and stopping honestly on source rate limits or incomplete work. It does not reduce the plan to a handful of laps.

`--export-seed` exports compact, version-matched, unexpired results for the normal Site publishing workflow. Raw full-session streams remain on the PC. The hosted Site cannot read the PC's disk, and locally cached results do not become public automatically. Publish an ordinary Site version to share an exported seed. This release includes Singapore results computed locally, so the hosted Site can serve those captured requests without recalculating them on Vercel. Uncached requests on the hosted Site still use its hosted API; use the loopback app to avoid that compute entirely.

### Verified reuse

For Singapore 2026, with the already-retained source files:

- First local warm-up of the new model: about **5 seconds** (not an internet-cold benchmark).
- Repeat non-race warm-up: **under one second**, all requested categories HIT.
- After restarting the actual runner: exact-fastest team and driver batches, summaries, pit/sprint records and corners remained HIT.
- Full race check: **123/123 team groups** and **123/123 driver groups** complete and cached; approximately **1 second** for the repeat command.

Unit tests additionally restart a fresh server instance with its upstream fetcher disabled and confirm a disk HIT. Host and Origin checks reject cross-site requests and DNS-rebinding hostnames. Only built public assets are served, not backend source files.

## Why Aston incorrectly topped the straight comparison

Replayed the exact fastest qualifying laps and the same two shared windows, **255.063 m** total. The old score summed elapsed time after spatial registration. A local distance/timing distortion in Alonso's trace compressed one 120.030 m window into 1.308286 s. That implies about **330.3 km/h**, whereas the native speed channel around the window was only about **291–296 km/h**. Whole-lap timing agreement had not caught this local inconsistency.

The corrected main straight score is explicitly a **speed-based, equal-distance time estimate**: integrate reciprocal native speed over the same supported distance windows. This is intentionally not measured track-window traversal time or a lap-time contribution. No global lap-time scaling or fabricated speed packets are used. The original GPS-registered elapsed time is retained as diagnostic evidence; source laps, shared windows and supported-field screening remain unchanged.

| Team | Source lap | Old registered time | New speed-based estimate | New gap |
| --- | --- | ---: | ---: | ---: |
| Red Bull Racing | VER L11 | 3.183412 s | 3.183678 s | 0.000000 s |
| Racing Bulls | LAW L14 | 3.191769 s | 3.187514 s | +0.003836 s |
| Aston Martin | ALO L8 | 3.029905 s | 3.260333 s | +0.076655 s |

Aston changes from first to tenth among the eleven teams in this narrow comparison. This is not a claim about overall engine power or aerodynamic drag. Only two windows are supported here; the chart now keeps **Speed-based estimate · 255 m · 2 windows** visible even with explanations hidden. Three displayed decimals do not establish millisecond measurement accuracy.

The change is versioned as `car-measurements-v15-straight-speed`. Older trace batches cannot migrate into the new model's cache. A regression deliberately gives a slower car an artificially compressed GPS clock and verifies that it cannot win the speed-based ranking. Acceleration/braking interval and corner calculations were not switched to this estimator.

## Screenshot-by-screenshot UI corrections

1. **Driver/tyre overlap:** normal-flow driver sidebar and cards, explicit desktop/tablet/phone grid rows, bounded driver-list scrolling and no horizontal driver scrollbar. Category navigation also no longer floats independently.
2. **Blue driver blocks:** neutral rounded list selection with a visible checkmark, smaller type and logos; team identity remains visible.
3–4. **Oversized telemetry summaries:** one compact row per lap on desktop (about **59 px**), identity/tyre/time, aligned sector values and a small two-by-two weather group. Removed decorative weather emoji. Smaller layouts stack these fields without dropping values.
5. **Poorly fitting section switch:** a smaller 304 px top navigation control, 28 px segments, 56 px header and restrained corner radii instead of an oversized floating capsule.
6. **Heavy team column:** normal-weight labels, 18 px logos, smaller cell padding, consistent row surfaces and no detached sticky first column.
7. **Oversized category controls:** 184 px category rail, 33 px desktop rows, smaller headings, compact context labels and 27 px related-choice controls. Replaced the prominent gold explanatory badge with quiet context text.
8. **Sort symbols:** small vector chevrons, no Unicode up/down glyphs on every header; unsorted indicators appear on hover/focus, the current direction stays visible, and headers expose `aria-sort`.
9. **Lap tiles/pills:** approximately 35 px desktop tiles with smaller tyre marks and metadata, denser grids, 30 px comparison pills and 28 px corner choices. Touch-specific hit regions remain larger.

Shared cards, charts, disclosures and toolbars use tighter padding and a more consistent alignment grid. The compact treatment follows Apple's [layout](https://developer.apple.com/design/human-interface-guidelines/layout), [lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables), [materials](https://developer.apple.com/design/human-interface-guidelines/materials) and [segmented control](https://developer.apple.com/design/human-interface-guidelines/segmented-controls) guidance as a web adaptation; it does not claim native AppKit rendering.
