# Tyre trend methodology review — 30 September 2026

## What the sources establish

[Formula 1's tyre graphic explanation](https://www.formula1.com/en/latest/article.explaining-the-new-tyre-performance-graphics-seen-on-tv.21CVJlHg0St8zrzaaVbU4L.html) describes estimating performance loss using timing, telemetry, tyre history, track status and weather. Its percentage is a model of remaining performance, rather than a measurement of rubber wear. [AWS's description](https://aws.amazon.com/sports/f1/) also uses acceleration and gyro measurements to estimate slip and tyre energy. Public FastF1/OpenF1 channels do not expose all those inputs, so this dashboard cannot reproduce that model or claim an equivalent remaining-life percentage.

[McLaren's Spanish GP strategy debrief](https://www.mclaren.com/racing/formula-1/2025/spanish-grand-prix/strategy-debrief/) shows why an isolated lap-time slope needs context: fuel load, traffic, compound grip, tyre management and strategy affect stint performance. The team uses simulations and operational knowledge alongside observed times. [Pirelli's Hungarian practice assessment](https://www.formula1.com/en/latest/article/what-the-teams-said-friday-in-hungary-2024.5L03XkP7mWuV3OUVbsnUgH.5L03XkP7mWuV3OUVbsnUgH) identifies track evolution, temperature and whether drivers push early or late as additional influences.

[A public state-space modelling paper](https://arxiv.org/html/2512.00640v1) uses stint resets, a separate assumed fuel covariate, compound effects and time-varying tyre pace. It reports uncertainty and tests predictions. Its example is one driver in one relatively clean race; it does not establish a validated universal season-ranking method. These are useful modelling principles, but adopting its priors or fuel assumptions as universal facts would overstate our evidence.

## Implemented changes

- Fit each driver, physical stint and uninterrupted green run separately. SC, VSC and red-flag interruptions split the fit.
- Use a robust Theil–Sen slope and reject isolated anomalous residuals around that trend. A coarse 7% gate removes gross errors first; the residual gate is the smaller of 2% of typical lap time and a robust scatter threshold with a 0.750-second floor. These are dashboard choices, not an official F1 threshold.
- Preserve three-lap runs as diagnostics. Headline results require six usable laps spanning five tyre-age steps. Corrupted or inconsistent tyre-age progression is rejected.
- Retain all observed ages. Require no matching rival for the independent tyre-age metric. A separate clean-air view requires a greater-than-two-second physical gap at available timing checkpoints.
- Show observed and assumed fuel-corrected trends. The 0.060-second-per-race-lap correction remains an explicit approximation; it is not calibrated to each circuit or the 2026 regulations. It must not be interpreted as measured fuel consumption.
- In the default team aggregation, summarize segments within the physical stint, take the driver's median stint rate, then average drivers equally within each GP and exact C grade. Average the observed grades within each GP for Overall. Every GP receives equal weight in the season summary; the default is the median GP. Mean, P75 and the former lap-weighted mode remain selectable.
- Report short runs, observed ages, sample counts, residual scatter and early/late rates. Draw a selected stint's actual usable laps against tyre age and its robust fit. Early/late rates require six laps in each half and sufficient age span.
- Determine used/new status from the tyre metadata and original stint history, rather than the age of the first lap surviving a traffic filter.

## Interpretation and unresolved limits

A rate of +0.050 s/lap means the fitted lap time increases by 0.050 seconds per additional tyre-age lap under the chosen correction. A ten-step illustration is +0.500 seconds if that trend continues; the model does not guarantee a linear future.

Race-lap and tyre age advance together within an uninterrupted stint. Fuel burn, track evolution and a common tyre trend therefore cannot all be independently recovered from those laps alone. Driver targets, traffic between timing checkpoints, temperature, damage and energy management remain confounders. Negative trends can be real observed improvements or evidence of these influences; they are preserved rather than clipped to force an expected ranking.

Retirement supplies no favourable score. A shortened run is only included if it passes the same evidence checks. Different circuit and compound coverage can still influence season comparisons. Exact C grades are pooled only within the selected year; identical grade names across different tyre generations do not imply identical construction.

## Validation

Deterministic checks cover slow-lap mistakes, real late-stint falloff, short runs, corrupt tyre ages, neutralisation splits, traffic sensitivity and unequal driver samples. UI checks exercise fuel, weighting and traffic toggles, sparse P75 results and finite three-decimal stint plots. A real-data check on Japan 2025 retained 41 supported runs across ten teams and 959 usable laps. This confirms coverage and numerical operation, not agreement with private team tyre models.
