# Prepared-data review, 2026-11-05

Current source 17534d7592c1c357898d and backend 2623ae524ce37d83e700
differ from preparation source b6adedb102cdf8caca3e/backend 0a1762c2ea19ed91113c
only in server.py and openf1_performance.py. Other hashed backend inputs match.

The changes recover missing driver team metadata from the same meeting, improve
red-flag detection, and attach SC/VSC/RED labels. Numeric pace, physics, timing,
telemetry, pit and corner models are unchanged; Python performance models do not
read red_flag or neutralised. Native telemetry packs are unchanged in schema and
meaning. Existing explicit predecessor allowances remain historical provenance,
not claims that those observations were freshly calculated.

The read-only retained-input audit found 41 changed red-flag lap labels in Mexico
race 11404, and zero in the other 18 indexed OpenF1 session routes. Blindly
accepting the old session presentation would therefore be incorrect.

refresh-prepared-annotations.mjs refreshes only red_flag and neutralised from
already retained race_control responses, under the OS-held capture lock. It
asserts every other driver/lap observation is byte-equivalent after JSON
normalization. Original capturedAt, source/backend/measurement revisions, native
timings, samples and missing-lap coverage remain intact. New content-addressed
payloads record a separate annotation_revision. Older payloads are not deleted.
Missing raw inputs abort migration. No downloads or telemetry calculation occur.

The strict release gate requires this current annotation revision for retained
OpenF1 session captures. The exact source/backend pairs are now reviewed; future
unknown revisions remain rejected. Missing Mexico lap 5 is still missing, not
zero or invented. Unknown team metadata remains unknown in historical captures;
it is not guessed from another weekend.
