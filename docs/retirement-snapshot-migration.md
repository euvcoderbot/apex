# Retirement metadata migration

The retirement-causes change adds LastName to OpenF1 driver classification and enriches retirement causes; it does not change observed lap or telemetry values. The exact new source identity 17e143bb8bcfc18ddebe retains the previously audited raw identities. Existing validated race-control annotations remain acceptable under that explicit policy.

Backend a250c97dc9498a11a10d retains prior observations only with a mandatory retirement metadata rebuild for every published race performance payload. The publication gate requires retirement_annotation_revision to equal the current backend identity. Source-only CI validates structure without requiring locally prepared publication metadata.

Run scripts/refresh-retirement-classifications.py with the Site checkout and backend identity. It uses the existing classifier and report matcher, requires car number, full name and complete retained lap count, preserves unmatched classifications, recalculates only retirement counters, and asserts equality of every non-retirement field. Original capture timestamps, revision identities and prior gzip payloads remain intact. Updated payloads receive new content hashes.

This does not approve arbitrary future revisions or silently re-label old computations as new. Future calculation changes need a new audit.
