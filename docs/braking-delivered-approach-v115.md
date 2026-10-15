# Braking retention correction — v115

The previous backend discarded valid native fixed-distance approach timings when
entry/exit speeds differed from the field median. The paired frontend then also
excluded these entrants from same-speed slowing. This was not a missing-download
diagnosis: the retained fastest qualifying laps contained usable observations.

Keep native timing support separate from boundary-speed compatibility. Delivered
time through is the default; strict boundary matching remains selectable. Both
paired metrics still use the same actual observations and entrant cohort. Clicking
Time through from independent slowing switches to the paired connected view.

## Replayed native observations

| Session and subject | Strict connected, supported | Delivered connected, supported |
| --- | ---: | ---: |
| Singapore teams | 8 | 11 |
| Singapore drivers | 13 | 21 |
| Bahrain/Sepang teams | 10 | 11 |

The new delivered connected view supports both metrics for these entrants.
Complete common rectangles intentionally retain fewer entrants: Singapore has
6 teams or 14 drivers; Bahrain/Sepang has 7 teams. Independent slowing does not
estimate approach time. Diagnostic quality can choose a different common set.

Delivered time through includes arrival/exit-speed differences, so it is combined
approach performance, not isolated brake strength. Connected ranks are estimated
fits through overlapping rivals, not identical all-field coverage. One-zone
entrants remain explicitly labelled limited coverage. Three decimals do not imply
millisecond source accuracy. Native spacing/quality gates and fastest-lap identity
remain unchanged; no missing native observations are invented.

Regression coverage includes boundary mismatch retention, unchanged native time,
cache invalidation, source identity, and 36 real replay combinations across subject,
basis, cohort and quality modes. Browser checks cover both metrics and transitions.
