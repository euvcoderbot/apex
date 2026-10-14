# Singapore acceleration and braking coverage — 14 October 2026

## Causes, not missing downloads

The driver 200–250 km/h chart selected a complete 13-driver / four-zone rectangle. VER, ANT, PIA, OCO and SAI had valid crossings elsewhere, but losing one chosen zone erased their whole band score. The default now uses the existing robust connected entrant/zone-effects fit, with physical zone and DRS state as comparison keys. The strict common rectangle remains selectable and shares the same quality-screened observations. Both team and driver views use only their exact fastest qualifying lap; no repeat/slower substitution.

Albon's source contained a short frozen 188 km/h shelf followed by 244 km/h after 0.280 s. It yielded a spurious 0.580 s 200–250 crossing. A permissive 3 g native propulsive-acceleration bound now removes this local corrupt interval, not his other measured zones. It is a quality ceiling, not an asserted typical F1 acceleration.

Braking formerly stopped at the last packet before the straight-window boundary, dropping crossings that happened inside the window but needed the next packet as their interpolation bracket. The next contiguous braking packet is retained only with a valid source interval and no speed rebound; both measured crossing positions must still lie within the same straight approach. It cannot extend a measurement past turn-in. Native interior-point counts and original bracket-resolution requirements are unchanged.

The endpoint search considers every eligible 10 km/h endpoint, not only the first/last sampled speeds. It first requires a supported three-entrant quorum, then prioritises entrants with no supported zone yet, paired support and total evidence. This deterministic, coverage-balanced choice avoids repeatedly favouring the same packet-rich entrants. Endpoints are identical for all entrants in a physical zone. The selected endpoints and exact source lap remain inspectable. It is a partial-zone comparison, not isolated brake hardware performance.

The initial braking view is now **All supported slowing**. Connected paired and strict paired comparisons remain available for comparing slowing and approach using identical evidence. The independent slowing view deliberately does not require or invent an approach result. Those cohorts must not be presented as interchangeable.

## Exact-source and live verification

| Singapore metric | Teams | Drivers |
| --- | ---: | ---: |
| 200–250 connected acceleration | 10 | 18 |
| 250–300 connected acceleration | 9 | 16 |
| All supported slowing | 10 | 18 |
| Connected paired approach/slowing | 8 | 13 |

Source: actual selected-lap archive replay and the deployed Vercel production API. Braking returns `qualifying-braking-v5-bounded-native-brackets`; acceleration returns `connected-native-zones-v3`. Singapore has 43 observed / 41 supported team braking intervals and 68 / 54 driver intervals. The unchanged Sepang archive retains 11 teams, 41 observed / 39 supported braking intervals and 11 settled-straight scores.

ALO and STR still fail the 3% timing-sector distance-registration gate; COL fails frozen-speed / time-agreement checks. They remain visible with exclusions, not invented scores. Other bands can legitimately have fewer eligible full-throttle, brake-free complete crossings even when a driver reaches that speed elsewhere. Singapore team 100–150 and both 300–320 cohorts remain unsupported; this change does not claim every band is complete.

Method revision invalidates derived caches while preserving raw source caches. Switching the acceleration comparison changes chart, table, coverage/evidence labels and season inputs without a network refetch. Browser visual QA remains unverified; local HTTP availability, automated UI-function tests and deployed API replays are verified.

Reproduce with `scripts/audit-singapore-bands.py <saved-archive.json>` and `scripts/verify-live-metric-support.mjs` (`--offline` for the saved exact replay). Numerical checks cover lap partitions, percent/second conversion, deceleration, distance normalisation and specific-power formulae.
