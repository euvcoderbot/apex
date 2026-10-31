# F1 Apex — final local engineering and interface review

31 October 2026. This supersedes `final-review-initial-findings.md`.

## Scope and exact state

Audited production source: `c2faaed855cc7985c4f4d76ad342f68a0ae022f8`,
Sites version **179**, independently confirmed from Sites version metadata.
Claude's integrated design baseline is `1bec80e`; the owner confirmed it finished.
Work is isolated in `audit/final-reliability-review`, in `apex-final-review`.
Final tested implementation commit: `84678cc` (followed only by generated data
identity and this report). The numerical correction is isolated in `0edf82c`.
No push, merge, deployment, installed scheduler change, historical-data deletion,
or destructive migration was performed. Other Claude worktrees were preserved.

The architecture actually has two execution paths:

- Browser HTML/JS telemetry workspace and React performance islands → published
  static session/lap/performance captures, with an optional Worker/R2 read cache.
- Local Node dashboard → loopback FastAPI/Python → retained native streams or
  upstream data → calculation caches → prepared exports → explicit sync/build/publication.

The hosted source origin is intentionally disabled; a published snapshot is not
a live compute service. GitHub main and production source differ: reliability
scripts and the frozen-dependency CI implementation were present in the production
checkout, not all on main. That is source divergence, not missing implementation.

## A. Reliability findings and corrections

| Severity | Verified defect and evidence | Files / correction | Verification and remaining risk |
|---|---|---|---|
| High | Release checks accepted arbitrary readable JSON and could skip absent entry maps | `lib/release-validation.mjs`, `scripts/check-release.mjs`: index/schema/route structure checks; compressed and expanded budgets | Negative corruption/schema tests and all 959 indexed payloads. Not a proof of physical accuracy or a cryptographic signature. |
| High | Sentinel ownership survived process death; writer lock scopes differed; prerender filenames depended on query rather than content | `capture_storage.py`, `lib/atomic-json.mjs`, cooperating capture/export/prerender/sync writers: one repository-wide OS-held lock; holder performs acknowledged index commits; durable content-addressed payloads | Real owner and Node-parent kills, helper death before commit, contention, injected ENOSPC/fsync/replace failure, old capture ordering, stale index preservation, immutable superseded payloads. POSIX execution and actual power loss remain unverified. |
| High | Official Madrid laps 91.824 s and 92.019 s had equal packet spans; driver order changed reference geometry and scores | `car_physics.py`, `performance_tracks.py`: approved official-time reference and chronological genuine tie-break; v5 method/revision | 34 recorded sessions, 1,376 laps, 676 supported driver-session outputs; analytic integral tests. Missing chronology is disclosed, not inferred from lap numbers. |
| High | Playwright reused another checkout's server on port 54140, so a successful run could test obsolete assets | `playwright.config.mjs`: owned server, reuse disabled, overridable dedicated test port | Wrong-server difference independently reproduced. Final browser checks use this checkout. Other user's servers were not killed. |
| Medium | Late cold computations and delayed durable writes could overwrite a newer manual refresh | `lib/data-cache.mjs`: request ordering and per-key commit serialization; a superseded response gets zero HTTP TTL | Two tests failed before the fix and pass after it. Guarantee is per cache instance, not distributed R2 compare-and-swap. |
| Medium | A failed partial qualifying refresh could replace usable derived data | `lib/qualifying-corner-loader.mjs`: do not persist a failed refresh over a prior result | Retained bytes and original expiry stay unchanged; the response still truthfully reports partial support/errors. |
| Medium | Refresh responses were eligible for HTTP/CDN caching | `lib/http-data.mjs`, data/qualifying/race routes: explicit refresh and POST responses are no-store | Header regression test; ordinary supported reads retain bounded cache headers. |
| Medium | Bodies were not fully bounded against deep JSON, compressed inputs or slow streaming | `api_security.py`, `lib/request-json.ts`: nesting, finite Python numbers, streamed byte limits and read deadlines; unsupported encodings rejected | Quoted brackets, nesting, non-finite numbers, compression and stalled-read tests. Not authentication or a defence against hostile programs already on the PC. |
| Medium | Unexpected runtime/storage messages could reach clients | `lib/http-errors.mjs`, hosted/local adapters: opaque unexpected errors, structured correlation IDs; safe missing-asset messages | Fault tests verify secrets/paths are absent and request IDs correlate. Deliberately public status messages remain actionable. |
| Medium | Segmented-control ResizeObserver retained removed controls | `ui-system.js`: release removed nodes and allow re-observation on reinsertion | 30 detached observed elements before, zero after, tested in Chromium and WebKit. No claim of a measured MB heap saving. |
| Medium | Preview server used a sibling-unsafe string prefix and threw on malformed percent encoding | `lib/static-path.mjs`, `scripts/serve-static.mjs`: separator-aware containment, bounded error handling, safe HEAD/method handling | Windows/POSIX path-semantics unit tests; malformed path cannot escape or terminate the handler. Not a substitute for OS filesystem permissions. |
| Low | Desktop tyre-grid geometry overrode the two-row phone layout | `workspace-ui.css`: restrict desktop grid to its intended breakpoint | Chart children stay inside their card while narrowing through 1440/1024/768/390/320 CSS pixels. Values/precision unchanged. |
| Low | Catalogue sidebar overflowed at 320 px; brand text was harder to read in light mode | Existing owner rules in `hig-system.css` and `tokens.css`, not a new CSS layer | Narrow catalogue test and automated contrast checks. Axe flagged 2.92:1 on brand text; logos have a WCAG exemption, so this is a legibility refinement, not a claimed logo compliance violation. |

React ownership was inspected independently: `src/islands.tsx` uses weakly held
roots; the owning performance-render paths call `unmountAll` before replacing
their parents. Repeated loaded navigation is exercised in browsers. No React
rewrite or removal of active `legacyTraces` was justified. The proven detached
observer issue above was separate from React root ownership.

## B. Numerical validation

Original benchmark baseline: **b799735**. Audited input method:
`speed-domain-v4-aero-unknown-integral`. Current method:
`speed-domain-v5-official-reference`; backend identity
`25ba619bb1ce1e8d9fa3`. Source identity remains
`5b02cc1bb2a6daf808ad`; corner measurement identity remains
`267fe2622a3941ad629a` through an exact-hash cache-write-only compatibility audit.

See `official-reference-selection-20261031.md` for the independently reproduced
Madrid defect and the specifically approved change. Raw telemetry, physics
equations and alignment were not shifted. Current adapters carry official time
and a common session completion clock separately from sample arrays.

Recorded corpus SHA-256:
`6e06f884740f6e7bf701f7c0b6e8684bac12ca81bfb2eaec4dd6ef0106060a7e`.
It includes 2025/2026 qualifying at high-speed, high-downforce and stop-start
circuits. Public results serialize without non-finite JSON; driver reversal
changes numbers by at most **8.881784197001252e-14** after the reference fix.
This is reproducibility, not proof of isolated car capability.

Independent analytic tests verify units, clipped interval boundaries and the
constant-acceleration ds/v integral. Existing tests cover synthetic grip/power/
braking changes, sparse packets, missing GPS, unknown aero state, corrupt lap
distance, local gaps and integration remainders. An adversarial internal-function
probe returned 40 findings, including intentionally unsupported NaN nodes and
explicit errors on invalid calls. These were not falsely counted as 40 public
model bugs: public input validation/masking and finite-output corpus tests were
checked separately. No broad numerical rewrite followed that probe.

Official lap metadata versus raw packet endpoint span differs by median 0.281 s,
p95 0.58725 s, maximum 1.924 s. These are endpoint coverage diagnostics, not
evidence to shift a trace. Estimated alignment remains opt-in; reconstruction
does not make missing observations measured. Missing aero state is a separate
unknown stratum, not silently assumed closed. Brake is on/off, not pressure.

Fuel, tyre condition, energy strategy, setup, tow and driver input are not all
observable. No authoritative independent dataset establishes their isolated
hardware effects here. The app must continue to describe delivered/modelled
performance and uncertainty. Historical v4 payloads were preserved unchanged
and remain revision-labelled retained results, not upgraded live v5 cache entries.
They were not all recalculated during this review.

## C. Security, integrity, CI and operations

Request guards include loopback Host/Origin/Fetch Metadata checks, explicit CORS,
bounded input, opaque unexpected exceptions and no-store errors. CORS is not
authentication. The public data service is read-only; the local Python service
binds to loopback. Source-file serving is allowlisted. Cold work admits at most
256 distinct in-flight fills per cache instance; hits and coalesced requests are
still usable under that limit. Upstream concurrency/cooldown tests pass.

The lock is cross-language/cross-process on a local filesystem, **not distributed**.
All cooperating export writers now share a repository lock, including manifests
outside local-captures. The lock holder commits indexes, so killing it does not
let its Node parent publish without ownership. Unique same-directory temporary
files are fsynced before replacement; directory sync is POSIX-only. Payloads are
immutable by content address; orphaned interrupted payloads may remain harmlessly
unreferenced. No age-based lock stealing or automatic sentinel deletion exists.

Coordinated rollout is required: stop every old writer, upgrade them together,
verify ownership before resolving a legacy sentinel, then restart. Never mix
old and new locking protocols. See `local-storage-hardening-20261031.md`.

CI source uses `uv sync --frozen`, npm ci, typecheck/lint/unit tests, release
validation and build. Python CI uses 3.12; the web job now also explicitly sets
up Python for the Node lock tests. Three-engine browser CI remains enabled.
No CI job result for these local commits is claimed: the user asked not to push.
This host has no WSL installation, and Linux/POSIX execution was not available.

Read-only production smoke independently loaded COTA qualifying with 22 drivers
and two telemetry traces, the 2025 calendar, and every major car-performance
category. No uncaught page exception was observed. Version 179 still reports the
old backend identity `f7216b3d5e4981b881ec`, correctly: this branch is unpublished.
Bahrain's optional pit-timing supplement returned 503 because that result is not
published in either capture index. Other supported results remained usable.
That missing supplement is not a zero-second stop and was not invented.

Installed task inventory was read, not changed: session archive/schedule refresh
tasks point at `apex-claude-release`, not this review checkout. The older raw
archive task is disabled. Sites reports no cloud schedules. These observations
do not establish that the installed scheduler runs this audited code or that PC
preparation automatically publishes a new Site version. Installed rollout and
any unattended authenticated writer require their own final approved integration.

Observability now supplies structured error correlation IDs, but there is no
verified production dashboard for freshness/latency/error-rate alerts. Rollback
should use the retained version-179 archive/source, not delete capture indexes
or relabel calculations. No rollback or deployment was executed.

## D. macOS design quality and component assessment

The project Figma file was read, including its component overview and segmented
states. Its earlier blue-tinted/Inter styling is a project reference, not an
official macOS 27 specification. Existing neutral tokens, native-on-Mac font
stack and component owners were retained. No competing theme or override layer
was introduced. The style build explicitly owns tokens, legacy rules, layout,
components, window chrome and system adaptation in named cascade layers.

Apple's [design resources](https://developer.apple.com/design/resources/),
[macOS 27 AppKit update](https://developer.apple.com/videos/play/wwdc2026/289/)
and [Liquid Glass presentation](https://developer.apple.com/videos/play/wwdc2025/219/)
were consulted. They support the separation of navigation/transient material
from dense content, restrained interaction and readable hierarchy. No Apple
spring constant, blur radius or timing value was invented. Direct inspection
of the linked official community kit was unavailable; exact native pixel parity
was not established. Geometry below is the tested **Apex web contract**.

| Component / macOS pattern | Assessment / correction | Evidence / browser limit |
|---|---|---|
| Window toolbar / title | Preserve concise hierarchy and system font stack; no fake OS traffic lights | Desktop/laptop/phone shell screenshots; Windows fallback is not SF on macOS |
| Sidebar source lists | Selected/disabled/long-label rows retained; catalogue min-width corrected | 320 px catalogue and phone workflows; full names retained in tooltips |
| Push / primary buttons | Existing 30 px desktop contract retained, not an unrequested pill resize | Catalogue states, focus and keyboard tests; touch preview is separate |
| Toolbar icon buttons | Existing symbols and accessible names retained | Ownership audit and actual toolbar interaction tests |
| Segmented controls | Moving shared thumb retained; detached observation fixed | Intermediate-frame movement and reversal; CSS approximation, not AppKit spring physics |
| Category tabs | Existing tab semantics, disabled skipping and arrow keys retained | Every loaded category; history/deep-link tests |
| Driver / lap choices | Selection and source lap values retained | Two-lap comparisons, missing-lap fallback and checkbox keyboard tests |
| Run selectors | Existing compact phase/compound hierarchy retained | Catalogue and run-preparation regressions; no fabricated tyre metadata |
| Checkboxes / radio / toggles | Native semantics retained; grouped toggle buttons are not incomplete radios | Automated accessibility and keyboard cases |
| Sliders / colour wells | Existing labelled native controls retained | Catalogue coverage; native picker appearance is browser/platform dependent |
| Pop-up selectors | Existing custom menu selection and focus restoration retained | Arrow/Escape/disabled option tests |
| Menus / popovers | Existing trigger anchoring and restrained appearance retained | Bounding-box and open/close tests; browser popover API limitations apply |
| Tooltips | Existing subtle overlay style retained, content remains selectable where appropriate | Catalogue screenshots and chrome/content selection tests |
| Modal sheets | Native dialog semantics retained | Keyboard opening, inert background controls, Escape and focus restoration; browser chrome may receive focus |
| Search / text fields | Existing labels and native editing retained | Accessible-name scans and keyboard inspection |
| Lists / result badges | Existing DNF/points baseline and stable row sizing preserved | Result-view unit checks and loaded screenshots |
| Tables / sort headers | Values remain tabular, precision unchanged and internal scrolling retained | Right-edge alignment, sort/keyboard and phone tests; wide tables scroll rather than shrink numbers |
| Resizable columns | Existing separator semantics and arrow/Home adjustment retained | Catalogue/ownership inspection; physical-device usability not certified |
| Loading / progress | Existing provisional, unavailable and partial states retained | Missing source and delayed-response tests; no blank success invented |
| Notifications / errors | Unexpected errors opaque; public messages actionable | Error-ID tests; no toast decoration added |
| Chart legends / controls | Trace selection, zoom and reference roles preserved | Recorded comparisons and chart-control tests |
| Bar / tyre charts | Mobile grid ownership corrected; numbers unchanged | Child containment across five widths; dense chart surfaces stay opaque |
| Disclosure / empty states | Existing native disclosure and honest no-data language retained | Catalogue, loaded and unavailable-session tests |

Dark/light automated scans covered the catalogue, shell and all eight categories.
The final diagnostic sweep recorded zero automated accessibility violations and
zero uncaught exceptions across those 20 pages. It also recorded one unresolved
resize warning: at 320 CSS pixels the tyre page can retain an 11 px empty
horizontal scroll range, despite its chart/value children fitting their card.
The cause was not established; no global clipping or speculative layout rewrite
was applied. This is a documented UI follow-up, not a claim that every reflow
case is perfect. The other 98 of 100 viewport/theme observations did not overflow.
The light brand colour was darkened for readability; the deliberate token update
is one value, not a global theme reset. [WCAG contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
also explicitly exempts logos. Automated checks are not full WCAG certification.

## E. Motion and material quality

The existing 150/220/320 ms engineering tiers and different easing roles were
retained. They are Apex tunings, not Apple's unpublished constants. A 30-frame
test observes actual intermediate thumb positions, reverses selection after five
frames and verifies return to the start. Reduced motion removes visible motion;
an existing near-zero CSS duration is accepted as such, not called a native spring.

Existing tests exercise pointer highlights, press/release scale, popover origin,
sheet/backdrop appearance and dismissal, interrupted navigation and per-element
animation cancellation. Data refresh does not restart chart-entry motion. No
decorative animation or shader dependency was added.

Toolbar/transient layers use shared neutral material roles; charts and dense
tables remain opaque. Reduced transparency and increased contrast use opaque
fallbacks; a user switch can disable glass feedback. Chromium can emulate reduced
transparency; WebKit cannot through this harness. Native refraction, system-wide
macOS sliders and actual SF rendering were not reproduced or claimed.

## F. Measured performance and regression evidence

Physics benchmark: Python 3.11.4, NumPy 2.4.6, Windows build 26220, six fixed-seed
synthetic cars (0..5), one warm-up, seven timed repetitions. The available b799735
baseline was actually loaded, not recreated. One reproduced comparison measured
baseline median 205.183 ms versus v4 75.307 ms (ranges 173.443–244.856 versus
73.992–76.251 ms). Traced allocation peaks were 403,721 versus 414,808 bytes.
A later v5 comparison under concurrent work measured 232.216 versus 146.581 ms,
with broader variation. The known synthetic numeric output is unchanged apart
from method/reference provenance. This reproduces earlier optimization; it is
not a claim that the reference-selection correction itself caused a speedup.
Tracemalloc is not total RSS or all native allocation memory.

Fixture-based Chromium workflow medians, three cold contexts at 1440×900:

| View | LCP | CLS | Long-task blocking | Observed interaction maximum | Transfer |
|---|---:|---:|---:|---:|---:|
| Empty session shell | 296 ms | 0.001 | 0 ms | No sampled interaction (0) | 425 KB |
| Pace, three GPs | 900 ms | 0.001 | 571 ms | 120 ms | 1,958 KB |
| Cornering, three GPs | 1,020 ms | 0.001 | 335 ms | 128 ms | 1,940 KB |

These are local recorded-fixture measurements, not live provider/API latency,
field Core Web Vitals or an independent before/after UI speedup. The benchmark
now isolates published indexes so they cannot override its fixture. The observer
fix has a concrete retention-count improvement; no unsupported heap/latency gain
is claimed. No validated model was simplified to improve these measurements.

Visual baselines: all 16 loaded-data differences were independently checked.
Every image kept its dimensions; every differing pixel was inside rectangle
`(311,159)–(504,172)`, the coverage subtitle. The old generic loaded-count text
was replaced by view-specific support counts. Only those reviewed snapshots
were regenerated; the subsequent normal 26-test visual run passed.

## G. Release readiness and actual test outcomes

Final verification results are recorded below after the implementation batch.
Do not interpret an environment block or unsupported source as a passing test.

- Passed: streamed request/security, cache ordering/admission, storage fault/
  contention/helper-death, release corruption and numerical regression tests.
- Passed: all 959 indexed release payloads, retaining 197 historical revision references.
- Passed: local lifecycle probe: another tab and reload keep compute alive;
  closing the last tab stops both dashboard and Python (final observed 5,823 ms;
  earlier run 6,685 ms).
- Passed: 26 Chromium visual tests after the specific reviewed subtitle updates.
- Passed: read-only production initial/COTA/category navigation smoke, with the
  explicitly missing pit supplement described above.
- Passed: clean `npm ci`, sync, release check, typecheck, lint, production build
  and full dependency audit (zero reported vulnerabilities).
- Passed: JavaScript **385 passed, 2 skipped, 0 failed** (387 discovered).
- Passed: all **24 Python test files**, including seven real storage/fault cases
  and the 34-session recorded numerical corpus.
- Passed: final owned-server Chromium/WebKit run **105 passed, 5 skipped,
  0 failed**. Firefox is separately blocked below, not counted as a pass.
- Build warnings remain in upstream Vinext/Rolldown plugins (source maps,
  ineffective dynamic imports and route classification). The build succeeded;
  this is not a warning-free or native-platform certification claim.
- No client `.map` files were found in the final `dist/client` output. Historical
  asset files remained unchanged; the final local worktree is committed for review.
- Skipped by explicit engine capability: WebKit reduced-transparency emulation,
  Chromium-only layout-shift observations and token snapshot duplication.
- Blocked: Firefox launch, including `--version`, fails with Windows SideBySide
  dependency `mozglue`/`spawn UNKNOWN`; a forced official Playwright reinstall
  did not resolve it. Firefox remains configured, not silently disabled.
- Blocked by local-only instruction/environment: actual Linux CI/POSIX locking
  execution; no PR or branch push was used to manufacture a passing status.
- Not executed: real macOS/Safari hardware, manual VoiceOver/NVDA certification,
  native desktop browser-zoom/assistive-technology certification (narrow CSS
  viewport reflow was tested), physical touchscreen trials, abrupt physical power loss, authenticated
  unattended publication, installed-task rollout, merge or deployment.

**Recommendation: not ready for an unqualified production-release sign-off.**
The local fixes and review can be handed off, but Firefox/Linux verification and
coordinated installed-writer integration remain gates; the 320 px resize warning
above remains a small UI follow-up. Historical results can
remain available with their original methodology labels; they must not be
represented as newly recalculated v5 results. Publication is a separate approved
operation, and the public site intentionally remains version 179.
