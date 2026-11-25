# From a weekend result to its evidence

## Assessment

The product already answers three different questions about a race. Classification tells us who finished ahead. The race model estimates pace under comparable conditions. Telemetry shows what happened on particular laps. Using any of these as shorthand for the other two would give a confident but misleading answer. The interface should make moving between them easy while keeping their units, scope and limitations visible.

The local 2026 snapshot exposed the problem clearly. Home opened with the Las Vegas forecast while São Paulo was the latest classified race. Results put eight record cards ahead of its Grand Prix list. The lap workspace already computed the largest gains and losses and highlighted selected corners on the trace, but the two interactions were separate. These are walkthrough observations. No user study or task-time measurements were available.

## Alternatives and priorities

| Area and question | Alternatives considered | Decision and trade-off |
| --- | --- | --- |
| Home — what just happened or what comes next? | A chronological news feed, a championship dashboard, or a weekend selected from the actual calendar | Lead with a race review when classification exists. Forecast and championship have their own views. A feed would need editorial content and chronology alone gives weak access to older rounds. The task switch costs one click but avoids scrolling through an unrelated forecast. |
| Results — what explains a finishing order? | Lead with season records, open a separate race page, or expand a round in its existing table | Keep the expandable classification and share its year and round with the pace and lap workspaces. History and links continue to work. Keep records after the list. |
| Session — where did one lap gain time? | Add another ranking plot, link the existing ranked losses to the map and trace, or build a synchronized replay | Use the measured section window as the selection. A replay would imply time synchronization that some captures cannot support. Display signed seconds and the existing reference lap. |
| Car performance — was an advantage sustained? | One composite car score or separate measurements scoped to the same race | Enter the existing pace analysis with the selected round. Preserve subject, coverage, session and method controls. A single score would hide the differences between modelled race pace and measured top speed. |
| Drivers, championship and teammate comparisons | Field-wide rankings, a fixed two-driver dashboard, or comparison reached from actual participants | Retain field tables for lookup and paired comparisons for questions involving two drivers. Home opens the season comparison with both podium finishers supplied. |
| Tracks, Development and Reliability | A new combined track timeline or the existing map, upgrade chronology and allocation grids | Keep each view's scale. A zone location, a declared upgrade and a replacement element describe different things. A combined timeline would imply causation the sources cannot establish. |
| Live | Merge live timing with the historical report or keep the live session explicit | Retain its separate entry and connection status. A saved race can have full classification and incomplete telemetry. |

## Reading the charts

Use the round matrix for exact finishes across a season, standings lines for championship progression, the race position chart for order changes and the gap chart for time behind the leader. Use stint intervals for tyre sequence, the distribution for lap spread and the aligned speed trace for one pair of laps. Gains in elapsed time and higher minimum corner speed are separate measurements. Keep signs, units, driver codes, non-colour selection cues, keyboard access and missing observations. A track outline describes location. An upgrade marker describes timing. Neither establishes a performance gain.

## Implementation order

1. Separate review, upcoming weekend and championship on Home. Keep the latest completed classification immediately usable and allow a different round to be selected.
2. Bring Grand Prix results forward, send the selected race into lap and pace analysis, and allow the leading pair to be compared across the season.
3. Connect the existing gain/loss list directly to the selected section on the trace and map. Preserve all calculations and the ability to select several sections manually.
4. Validate navigation with populated snapshots and recorded telemetry, then inspect phone and desktop layouts, keyboard focus, missing data and numerical regression tests.

## First-stage verification

The first-stage Chromium suite passed all 135 tests, including visual comparisons. The two new workflows also passed in Firefox and WebKit. The quick Linear audit in WebKit reported zero findings across 24 renders. JavaScript unit tests recorded 430 passes and four skips. Lint and TypeScript checks passed. The source release check validated 745 referenced files, including 20 season snapshots.

Home was inspected with populated 2026 data at 1440 and 390 pixels in both themes. At São Paulo, Norris appears first in both classifications, while Russell qualified second and Verstappen finished second. The race review preserves that distinction and opens the season comparison for the two race finishers. Automated checks include returning to the chosen Grand Prix and moving keyboard focus from a signed section delta to its selected track section.

## Wider workspace changes

| Workspace | Earlier experience | Implemented investigation |
| --- | --- | --- |
| Standings | Only the latest table could be read alongside the progression charts. | Choose a Grand Prix to see the championship as of that round. Driver and constructor tables, recent points, splits and chart history share the cutoff. The current title projection appears only at the latest round. |
| Drivers and Head-to-head | Outcomes, season trends and comparison graphics shared a long profile. The head-to-head matrix required horizontal navigation on phones. | Profiles separate the race record, season trends and comparisons. The weekend log shows the shared qualifying phase, gap and race finishing positions in a vertical list. |
| Calendar and Tracks | Reviewing upcoming session times required stepping through weekend cards. Opening a circuit requested its historical seasons. | Session agenda lists the upcoming weekends in local time. Circuit history loads when requested. A classified circuit links to that round’s qualifying session. |
| Development and Reliability | Finding an upgrade declaration or a new installation meant scrolling past aggregate rankings. | Read declarations by weekend or investigate season patterns. A populated matrix cell opens that team's disclosures for the round. Installations have their own view alongside totals and finishes. |
| Car performance | Two entrants could occupy different ranking rows in each plot. | Compare two entrants brings the plotted values together with their original benchmarks, precision and accessible descriptions. The rankings stay available as context. |
| Session and Live | Distribution, field summary, race order and traces competed for vertical space. Live tower choices and lap charts were independent. | Choose the session evidence to render. Live has timing and strategy, completed laps, and current telemetry workspaces. The lap chart can follow the tower selection. |

## Final composition

On wide screens the expanded rail contains Season destinations. On phones a page chooser shares the header with the year, and Car performance uses a measurement selector. The weekend strip and Grand Prix picker on Home share a selection. The two head-to-head driver fields sit either side of the swap action on phones.

The tyre-age ranking previously led into a collapsed run inspector deep in the page. “Inspect a stint” opens the recorded run as the primary view. Select a team, driver, Grand Prix and stint, or open the individual recorded laps beneath the plot. The field ranking and matched-rival model keep their own benchmarks.

Development previously paired a season trend with a season change ranking. Choose a Grand Prix to mark it on the shared-scale plot and replace the ranking with that round's exact team gaps. The qualifying link carries the year and round. The season's FIA declarations are a separate source for what teams reported changing. A missing round stays a gap in the line.

Session overview and lap telemetry now link to each other when a comparison exists. The Live client loads when local compute is available. Missing forecast wind, rain or temperature shows a dash while zero rainfall retains its measured value.

## Verification before the final composition

The full local Chromium run passed 137 tests, including visual comparisons. Twelve Windows comparison baselines were reviewed and refreshed. The Session download passed its existing 200 KB limit after comparison code moved to the Car performance module. A fresh Session visit and subsequent prepared-data lookup requested the capture manifest once in the local snapshot-mode check.

The recorded-data walkthrough covered Season and Session at 390 and 1440 px. Live tab switching was exercised in local-compute mode without connecting an F1 TV account.

## Final rendered review and limitations

The complete Chromium pass exercised 138 cases. It passed 137 and found one regression. Session was downloading the Season stylesheet before anyone entered Season, taking its initial styles to 83 KB against an 82 KB budget. Season now requests its stylesheet on entry. The shared entry controls load with the shell. The budget passed on recheck with its original threshold.

The final seven-case Chromium recheck passed, including the budget, Season navigation, phone stint inspection and all four tyre and development visual comparisons. The route matrix covered 390, 1024 and 1440 px in both themes. Screenshot inspection led to two corrections: removing the obsolete disclosure around the selected stint plot and putting the phone head-to-head pickers on one line with the swap button between them.

Four workflows passed in both Firefox and WebKit across the final runs: inspect laps and follow a qualifying round, return to the selected weekend through browser history, and read the two driver panels at 390 and 1024 px. JavaScript finished with 430 passed and four skipped. Lint and TypeScript passed. The browser cache revision changed. Source, backend and race revisions stayed the same.

These results cover local snapshots, recorded sessions and the local-compute interface. Live account operation, real-device Safari, field performance and task completion by actual users remain unverified. The redesign is available in the local preview and has not been published.
