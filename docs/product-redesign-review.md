# F1 Apex Data product redesign review

## A. Understand the product

The starting point is a question with an explicit scope. A classification is one session’s observed order. A qualifying comparison can use only a phase both drivers reached. Race pace and tyre trends are estimates over eligible laps. An FIA declaration records a change, not its performance effect. A replay has a clock independent of the saved Season snapshot. Those distinctions determine what can be joined and what needs a separate view.

| Scope | Primary records and entry points | Decisions the interface must support |
| --- | --- | --- |
| Season and championship | Season snapshots, standings by round, driver profiles, race and sprint classifications, head-to-head | Choose year, round, entrant and comparison; preserve the selection while changing evidence. |
| Weekend and circuit | Calendar, forecasts, circuit profiles, official zones, results, stints and pit timing | Move from a scheduled weekend to a classified result or to specific circuit evidence. |
| Car performance | Event subset, team/driver rankings, uncertainty ranges, eligible laps and evidence tables | Compare like measurements, inspect sample coverage and distinguish an estimate from an official time. |
| Session | Lap observations, aligned channels, sector intervals, corner windows and distribution | Find an unusual lap, compare it with a reference and identify where time changed. |
| Operations | Development declarations, allocations, reliability records and Live/replay timing | Inspect a documented event, component or driver without implying cause or forecasting failures. |

The signed-in Linear reference governs surface contrast, hierarchy, type weights, spacing and focus. The shell, command search, views and domain charts already have separate owners. The redesign uses their existing selection, URL, tooltip, source and reduced-motion conventions. The light reference is based on published tokens. Desktop and phone have different space for persistent navigation.

## B. Critique the evidence displays

| Display family | Question | Precision or usability issue | Treatment |
| --- | --- | --- | --- |
| Weekend classification and calendar | What happened, and what is coming up? | Forecast can bury the last result; qualifying position can be mistaken for finishing position. | Select a weekend, juxtapose the two named classifications, show qualifying phase and race elapsed time/gap. Separate upcoming sessions and forecast. |
| Championship table, points lines and position chart | What was the order after this round? | Latest table and earlier chart points can describe different dates. | Give the table and both histories one round cutoff. Restrict present-day title projections to the latest standings. |
| Driver record, distributions and head-to-head | Was the advantage consistent? | A season-long horizontal matrix is difficult to compare on a narrow screen. | Keep the matrix for patterns, add a vertical weekend log with both finishes, shared qualifying phase, driver code and signed interpretation. |
| Track map, zones, corner and speed tables | Where does the circuit impose a different demand? | An outline locates a corner but cannot communicate the source lap or prove an aerodynamic advantage. | Pair map and exact readings, expose qualifying evidence in context, and give historical circuit records a separate view. |
| Pace rankings and uncertainty | How far apart were these entrants? | They occupy different ranks across plots; reading two bars without the benchmark or sample context invites bad comparisons. | Bring their existing readings and accessible descriptions into a paired table. Preserve every plot’s field benchmark, whiskers and unranked entries. |
| Cornering, braking and straight-line measurements | Which speed regime or section separates the cars? | A speed difference and a time difference answer different questions. Public traces cannot resolve downforce or electrical deployment. | Retain units and measurement-specific rankings. Keep section, team/driver and qualifying/race controls with the evidence. |
| Pit timing and tyre trend | Where was time spent, and how did comparable stints evolve? | A stationary stop, time in pit lane and modelled degradation are different quantities. | Retain separate measures, compound basis, actual stint plots and coverage. Use paired comparison for eligible rankings only. |
| Sector strips, dominance map and speed traces | Where did the reference lap gain time? | Faster minimum speed does not imply a faster corner. Map colour alone lacks the exact distance and signed delta. | Link a measured gain/loss to the same reference window on map and trace. Preserve explicit reference, seconds and km/h. |
| Lap-time distribution, field table and race order | Was a lap representative of the session? | A fastest lap, a typical lap and a gap to the leader require different scales. | Give each its own workspace view. Retain slower-lap handling, missing samples and exact table values. |
| Development chronology and component grid | Which team declared which change at a weekend? | An aggregate count gives neither the component nor its stated purpose. | Open declarations by team and round from a populated cell. Keep the FIA document accessible. Separate the aggregate pattern. |
| Allocation and retirement tables | Was a part fitted, over allocation or associated with a retirement? | Initial totals can look like new installations. A no-show has an unknown cause. | Separate changes by round, total use and finishes. Retain starting-total styling, sourcing and missing-cause notes. |
| Live tower, strategy, telemetry and race control | What is happening now, and which completed laps explain it? | A current telemetry sample and a completed-lap observation have different clocks. Multiple independent driver choices break continuity. | Separate timing, completed laps and current traces. Let the lap chart follow the tower selection, retain replay seeking and connection status. |

## C. Explore compositions and choose

A weekend-first product works well for Home, Calendar, Tracks and Results because all four can refer to the same Grand Prix. It would make a season-wide comparison tedious. A driver-first product works for profiles and head-to-head but biases circuit and component analysis toward a single entrant. An evidence-first workspace fits telemetry and car rankings, but is too dense for a landing page. Use all three with explicit handoffs carrying the relevant year, round or drivers.

For the shell, a permanently expanded table of contents exposes every destination but consumes too much of a phone. Nested menus save space but hide common destinations. Use a persistent route list where the viewport supports it, a compact section chooser on phones, and local controls for the active analytical question. Keep Back, keyboard activation, focus and command search as alternate paths.

| Investigation | Alternative | Chosen direction and cost |
| --- | --- | --- |
| Championship | Drag a crosshair across the points chart to change the date | A named Grand Prix selector drives standings and history together. It works by keyboard and identifies the cutoff even when a round has no plotted mark. |
| Head-to-head | Shrink the full season matrix to phone width | Keep the matrix for spotting runs of results. The weekend log trades horizontal scanning for one readable chronological row per race. |
| Circuit history | Preload every year into one all-circuits dashboard | Fetch history on entry to that view. The first visit can take longer, while a visitor interested only in corners avoids those reads. |
| Tyres | Overlay every stint on the field ranking | Give one run its own lap plot and recorded-lap table. Team, driver, race and compound stay explicit. Switching back to the ranking costs a selection but its units and population stay clear. |
| Development | Put upgrade counts and pace on two axes | Mark the chosen round on the qualifying chart and list the corresponding team gaps. Link to dated declarations and qualifying laps. This supports investigating a coincidence without implying a measured upgrade effect. |
| Reliability | Combine season usage, installations and retirements into a single score | Keep distinct units. The weekend installation matrix locates a change, season totals describe allocation pressure, and finishing records describe outcomes. |
| Live | Put timing, strategy, completed laps and current telemetry in one continuously updating wall | Keep timing and strategy together. Give completed laps and current telemetry their own workspace with driver selection carried into the lap chart. The operator trades continuous visibility of all channels for a stable reading position. |

Existing view transitions provide continuity between measurements. Selection uses pressed states, driver names, focus and values alongside team colours. Season drill-down scrolling respects reduced motion. The Live layout separates updates at different rates. No telemetry interpolation or forward simulation was introduced.

## D. Implementation sequence

1. Make Home, race reports and lap sections work as one weekend investigation.
2. Add historical and cross-entrant investigation across Season, Session and Car performance.
3. Separate operational views in Development, Reliability and Live.
4. Consolidate navigation, active scope and mobile hierarchy across those workspaces.
5. Inspect the complete composition with historical snapshots and recorded sessions. Record verification and limits in the implementation report.

## Coverage of the original brief

| Brief section | Result in the implementation |
| --- | --- |
| 1. Visual foundation | Existing shell, surfaces, typography, chart tokens, interactive controls and keyboard focus supply the visual language. The desktop rail houses Season destinations and the phone uses an inline page chooser. |
| 2. Composition and grouping | Home selects a weekend, Results opens its classification, Drivers separates record, trend and comparison, and Car performance selects a measurement. |
| 3. Analytical workspaces | The historical round selection coordinates standings with points history. A selected time gain focuses its map and trace interval. The car comparison presents the two entrants against each metric's original benchmark. |
| 4. F1-specific investigation | Qualifying phase, finishing order, stint age, pit time, speed, elapsed time, model fit and actual observations retain their separate meanings. The app exposes the available measured and estimated quantities. The supplied data does not establish a physics-based forecast of a future upgrade. |
| 5. Visual evidence | The audit above records the question, weakness and resolution for each display family. Round inspection lists missing readings explicitly. Exact tyre laps sit beneath the selected stint. A missing forecast observation displays a dash and measured zero rain displays zero. |
| 6. Interaction | Linked highlighting supports keyboard focus. Browser history, comparison selections, reduced-motion scrolling, scoped loading and existing empty states are part of the workflow. |
| 7. Journeys | Home → Grand Prix report → car pace or session laps carries the weekend context. Development → qualifying carries the round and year. Standings → Drivers and the paired head-to-head remain available for season questions. |
| 8. Technical constraints | Changes are in presentation, navigation, resource loading and regression coverage. Calculations, API contracts, saved snapshots and source measurements retain their original semantics. |
| 9. Phases A–E | Inventory, critique, alternatives and implementation sequence are recorded above. The companion implementation report records what was rendered and exercised. |
| 10. Quality | Dense matrices remain for season-wide pattern finding. The phone gets a chronological comparison, compact page and measurement selectors, and focused evidence views. Numeric precision remains available in tables and plots. |
| 11. Deliverables | This review supplies assessment, weaknesses, alternatives, trade-offs and priorities. The companion report lists the before-and-after changes, observed verification and limitations. |

## E. Validation criteria

A user can change the active round, follow a pair of entrants and return to context; examine the original reading behind a comparison; distinguish unavailable data from a zero; and reach the same controls by keyboard or on a phone. Review populated and empty states, light and dark screens, disclosure behavior, chart units and overflow. Preserve the numerical regression suite and existing download budget. Fixtures exercise replay and local compute; public Live account operation and human task-time measurements need separate evidence.
