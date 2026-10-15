# Braking — two metrics, one methodology

The braking card has one two-way selector: Same-speed slowing (default), and
Time through braking zone. Removed the cohort, boundary-matching and diagnostic
quality selectors, their event handlers and the braking season summary selectors.

Both metrics use supported paired native observations from the fastest eligible
qualifying laps, with a zone-adjusted comparison through overlapping rivals.
Season aggregation fixes equal-GP mean weighting, independent of summary settings
selected in other categories. Native sample quality gates and source lap identity
are unchanged. Provisional observations remain inspectable but cannot enter ranks.

Methodology, coverage and source-resolution caveats are collapsed under Calculation
& sample support. Boundary speeds and exact measured intervals remain in evidence.
Time through measures the delivered fixed-distance approach, including entry and
exit speeds. Same-speed slowing times the shared speed reduction within each zone.
Neither is an isolated brake-hardware measurement.

This is a presentation and policy simplification of the v115 default calculation,
not a new numerical accuracy claim or a relaxation of source quality.
