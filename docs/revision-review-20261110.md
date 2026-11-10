# Prepared-data review, 2026-11-10

Current source ee687c9caceb6bed2c0b and backend 277639bebfb0613957d0 differ from the
preparation source 1493e081d26a72cd8feb / backend 95272b8c86a3b0b51eca in:

- `server.py`: the OpenF1 session builder now gives each qualifying lap its phase (Q1/Q2/Q3)
  from race control's `qualifying_phase` tags, falling back to the timing gaps below. It
  previously wrote `phase: null` for every lap, so every OpenF1 qualifying capture showed all
  laps as "Unassigned" in the lap sheet.
- `openf1_performance.py`: `qualifying_phase_bounds` (the timing fallback, used only when
  race control carries no phase tags) and its use in the performance adapter for Q/SQ.
- `fia_documents.py`: header-less car-presentation pages are read (Red Bull 2025); this
  affects the upgrade snapshots only, which were rebuilt.

Lap times, sectors, telemetry, stints, compounds, deletions, red-flag and neutralised labels
and every performance model are unchanged. Only the `phase` field of qualifying and sprint
qualifying laps differs.

Checks:

- Bahrain 2026 qualifying from the patched builder matches FastF1's own phase split on all
  239 laps (Q1 113, Q2 69, Q3 57).
- The timing fallback, applied to the 26 retained 2026 qualifying and sprint qualifying
  captures, found boundaries for 22 and put no lap in a phase its driver did not reach
  (0 of 7,108); the other four would stay unassigned rather than guessed.

Migration:

- Every 2026 qualifying and sprint qualifying capture is re-exported at the current
  revision (new captures, new capture times).
- All other retained OpenF1 session captures are stamped by
  `refresh-prepared-annotations.mjs`, which refreshes only race-control labels offline and
  asserts every other observation is unchanged.
- `lib/snapshot-policy.json` accepts 1493e08 / 95272b8 under the new revisions, so retained
  observations keep their original provenance.
