# Retirement metadata migration

The retirement-causes change adds LastName to OpenF1 driver classification and enriches retirement causes; it does not change observed lap or telemetry values. The exact new source identity 17e143bb8bcfc18ddebe retains the previously audited raw identities. Existing validated race-control annotations remain acceptable under that explicit policy.

Race performance snapshots carry a separate `retirement_annotation_revision`. It hashes the classifier, retirement counts, and report parser and matcher. The publication gate still checks the snapshot's calculation revision independently. A traction, pace, or other unrelated calculation change leaves the retirement revision valid.

The release gate accepts the audited legacy stamp `2e4a10782d8503619079` under retirement revision `8af09b53855a2c0be4b1`. The retirement inputs match the code that produced that stamp. A change to those inputs produces a different identity and requires a refresh. Source-only CI checks committed snapshot structure.

When retirement rules change, regenerate the revision with `npm run sync:apex` and run `python scripts/refresh-retirement-classifications.py <prepared checkout>` from that same code revision. The script matches car number, full name, and complete retained lap count. It keeps unmatched classifications, recalculates retirement counters, and verifies that every other observation is unchanged. Updated payloads get new content hashes and keep their original capture timestamps and calculation revisions.
