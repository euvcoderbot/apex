# Session and car performance implementation pass

This is the feature-by-feature implementation record for the approved plan. “Retained / tested” means the existing implementation met the checks and was not rewritten just to create a change. Missing observations are never replaced with zeros or slower qualifying laps. Displaying three decimals does not establish millisecond measurement accuracy.

## Session analysis

| Feature | Implementation / verification |
|---|---|
| Season selector | Telemetry years start at 2018; direct API boundaries remain tested. |
| Event and session defaults | Latest completed session timestamp selects both event and session; live/cancelled/unknown and interrupted-session rules retained and tested. |
| Session loading | Added a real Stop loading action. Failed/cancelled loads retain the previous workspace; replacement happens only after a valid response. Previous controls are inert during loading. |
| Retry and stale responses | Transient retry and generation checks retained; an old request cannot overwrite a newer selection. |
| Driver list | Historical team identity and verified local logos retained; sidebar visibility now persists. |
| Race points / gap | Official classification merge and bounded post-race refresh retained and tested; lapped finishes and missing results are distinct. Publication delay at the provider cannot be eliminated. |
| Event tyres | Verified year/round allocations retained; unmapped exact compounds are not invented. |
| Runs and stints | Compound transitions, missing lap times and IN/OUT state retained. Selecting a driver does not fetch telemetry. |
| Fastest qualifying lap | Fastest legal lap across Q1/Q2/Q3 remains the representative; no slower teammate replacement. |
| IN/OUT lap comparison | Retained. Pit-out traces are partial and do not receive a synthetic complete-lap timing delta. |
| Comparison tray | Reference lap, same-driver lap identities, colour overrides and trace visibility retained and tested. |
| Sectors and weather | Official sector timing anchors retained. Race weather lookup performance check passed; session/lap weather remains context, not causal correction. |
| Spatial alignment | Real registration retained, rejecting inconsistent/displaced archives. No speed-feature snapping of driver braking points. |
| Speed trace | Raw samples remain the default; bounded enhanced reconstruction is optional. Trusted samples and official anchors survive replays. |
| Timing delta | Official start/sector/finish deltas retained exactly. Missing/partial laps remain explicit. |
| Throttle | Raw measured samples retained; full throttle is not treated as proof of clean air or engine power. |
| Brake, gear and DRS | Removed inferred DRS and false missing-brake zeros. Discrete states now change at observed packets, with gaps represented consistently in drawing and hover. |
| Hover | Cached static canvas layers and animation-frame coalescing replace full chart/map redraw on every pointer movement. |
| Zoom and touch | Pointer capture/cancellation added; one distance window continues to drive the stack. Expanded view restores the previous zoom and delta scale. |
| Expanded speed/delta view | Retained as optional; it does not require browser zoom. |
| Corner labels | Native circuit positions, actual circuit identity and collision-aware vertical leaders retained. |
| Speed annotations | Still one optional control, off by default. Three-decimal values and a complete evidence table expose labels omitted from the canvas for space, including every visible lap and missing measurement. “Apex” replaces ambiguous “carry.” |
| Reconstruction evidence | Estimate markers and source limits retained. Interpolation does not manufacture sensor frequency. |
| Single and combined corners | Union windows are summed once; combined mean speed replaces a meaningless combined minimum. Retained and tested. |
| Selected map zones | All merged selected windows and their outer boundaries remain marked, including disjoint selections. |
| Mini-sector dominance | Shared aligned 25 m segments retained; map hover now uses a cached layer. |
| Wind / map orientation | North-up convention and meteorological “wind from” retained. |

## Car performance

| Feature | Implementation / verification |
|---|---|
| Season / selected tracks | Scope and explicit Analyse behaviour retained; completed supported data survives Stop. |
| Category loading | Race cornering, qualifying corners, fastest-lap braking and race speed traps have independent paths. Race ST no longer waits for qualifying GPS. |
| Missing entrants | Expected qualifying entrants remain visible in tables without fabricated scores. Measured but unranked braking evidence remains available. |
| Coverage | Common observed and coverage-adjusted diagnostic modes remain distinct. Supported GP/zone counts and ranking support are exposed. |
| Qualifying pace | One fastest valid Q1–Q3 lap; mean/median GP summaries and source-lap evidence retained. |
| Track-evolution diagnostic | Separate from the default fastest-lap metric; compound/wet/unknown-tyre safeguards retained. |
| Race pace | Shared race-lap, compound and tyre-age model, driver estimates, traffic sensitivity and residual diagnostics retained and tested. |
| Qualifying cornering | Map-anchored entry/apex/exit windows cover flat-out corners as well as lifted/braked corners. Slow/medium/high classification and Sepang T5/T6 checks retained. |
| Race cornering | Separate subcategory; same lap/compound/nearby tyre-age matching and connected cohorts retained. Displaced source archives cannot create false Alpine dominance. |
| Team / driver telemetry | Independent fastest driver laps and team representative rules retained for corners, straights and braking. |
| All / low / medium / high charts | Retained for both cornering sessions; incomplete bands stay unavailable. |
| Settled straight performance | Headline excludes early exit and braking portions. Seconds and lap-percentage summaries remain selectable and explicitly describe different season weighting. |
| Exit-inclusive attribution | Preserved only as a separate diagnostic, not labelled pure straight-line/drag performance. |
| Acceleration bands | All supported bands from 50–100 through 350–400 remain selectable. An unavailable selected band is no longer silently replaced by another. |
| End-of-straight speed | Same supported terminal windows retained; not conflated with native peak or official ST. |
| Qualifying top speed | Independent peak and GP-relative shortfall retained with source lap/GP evidence. |
| Official ST / FL | Separate measured checkpoint values retained. |
| Race ST | Consolidated duplicate render paths. Peak-only/unmatched entrants remain in context tables rather than disappearing; matched gaps remain unscored when unsupported. |
| Braking source selection | Only the actual fastest qualifying lap per entrant. Paired charts use identical laps, zones, entrants and supported GPs. |
| Approach time | Fixed-track-section timing retained; unavailable selection stays selected and is explained instead of switching to slowing. |
| Same-speed slowing | Native source timing across the shared speed drop retained; seconds per zone, not whole-lap loss. |
| Braking quality / stability | Supported vs provisional observations, endpoint brackets, source speeds, coverage and leave-one-GP-out stability retained. |
| Deceleration / distance | Same paired observations retained. These can disagree with approach-time rank because boundary speeds and the timed interval differ. |
| Braking power proxy | Labelled energy-loss rate only. Public on/off brake data cannot isolate brake pressure, friction-brake power, drag or regeneration. |
| Stationary pit stops | Published stationary values only, separate from lane time. Unavailable stationary view no longer automatically switches to lane. |
| Pit-lane time | Raw visit-weighted and equal-GP-relative modes retained; not labelled pit-stop loss against staying on track. |
| Pit team / driver | Separate entity selections retained for both measures. |
| Pit summaries / chart | Mean, median, quickest, middle-50% spread and P10/P90 chart/table consistency retained. Four-sample spread and ten-sample tail boundaries tested. |
| Exact pit visits | Provider precision retained with source/visit evidence; no estimated stationary times. |
| Exact-compound tyre trend | Within-driver C-grade fits retained, independent of rival retirement counts or assumed team order. |
| All usable tyre ages | Removed the flat 7% pre-fit cutoff. Robust residual screening now starts from the complete already-screened green run, preserving genuine large total degradation. |
| Tyre lap eligibility | Pit/wet/neutralised laps excluded; neutralisation splits runs. Outlier lap, tyre age, time, residual and reason are now recorded. |
| Fuel sensitivity | Raw and user-selected assumed fuel correction remain distinct. The fuel assumption is not a measured load. |
| Tyre weighting | Equal-driver and lap-weighted GP/C-grade summaries retained; each supported GP has equal season weight. |
| Tyre season summaries | Mean, median and P75 retained; P75 remains selected when sparse and shows the per-grade shortfall. |
| Tyre run inspection | Team/driver/GP/stint picker retained. Added optional hollow excluded-lap dots when the new API provides the evidence. Early/late and block-sensitivity diagnostics retained. |
| Matched-rival tyre view | Old section preserved separately, not substituted for own tyre-age change. |
| Relative qualifying progression | Actual round spacing and missing-round gaps added to sparklines. Observed change and fitted change now drive their own selected column/sort. |
| Upgrade documents | Renamed as FIA reference documents, not a fabricated ingested upgrade/causal-impact database. |
| Reliability / results | Race-only points label, driver-entry denominators and explicit unknown retirement causes retained. Not a championship-points or pure reliability claim. |

## Shared implementation

| Feature | Implementation / verification |
|---|---|
| Descriptions | One persistent site-wide Show explanations control; shared plain-language definitions replace stale descriptions. |
| Numeric presentation | Three decimals for measured performance times, gaps and speeds; integer counts and provider exact-visit precision remain appropriate exceptions. |
| Sorting | Independent table sort state; missing values stay last in both directions; table scroll, page position, disclosure state and focus are restored. |
| UI density | Compact aligned controls, consistent action heights, non-inflated development rows, wrapping toolbars and restrained evidence tables. |
| Accessibility | Named groups, pressed/selected states, keyboard focus restoration, inert loading/collapsed regions and reduced-motion behaviour retained. |
| Expensive evidence | Closed evidence tables hydrate only on expansion and offer filtering for larger tables. |
| Browser calculations | Event summaries survive unchanged renders and invalidate when source references or methodology controls change. |
| Source / result caches | Shared durable cache, bounded memory and cold-request coalescing retained. Removed forced telemetry refreshes and canonicalised ignored calendar/session cache-busters. |
| Cache invalidation | Source, backend calculation and race snapshot revisions remain separate; changed old results are not rebranded as new. Live/recent events revalidate more often than historical ones. |
| Bundle / duplicate code | Consolidated duplicate race ST renderers and explanation controls; new shared definitions/format/channel helpers are shipped and static asset allowlists updated. |

## Verification and limits

- Full JavaScript suite: 123 passing tests, including real Sepang alignment, race-corner recovery, braking pairing, all speed bands, pits, sparse P75 and the new missing-channel/cache/loading cases.
- Python suites: 85 passing unit tests; real cached circuit checks additionally passed for Monaco, Monza, Silverstone and Suzuka, plus an unverified-energy-envelope rejection.
- Telemetry replay: 46 cached laps; trusted measurements and official timing anchors remain exact. Enhanced reconstruction improves the non-stale held-out subset, but large uncertain gaps remain unsuitable for precise performance claims.
- API methodology is versioned as `theil-sen-residual-screen-v4-full-age-span`; `/api/health` exposes that method and prepared-cache revision for deployment verification. The frontend warns when loaded tyre results still use the old fit.
- Sparse source data, provider post-race delays and disconnected race cohorts remain real limitations. This pass does not force a complete ranking where observations cannot support one.
- No public data supports a pure aero/downforce/engine/brake-hardware or physical tyre-wear rating. No expected team order is hard-coded.
