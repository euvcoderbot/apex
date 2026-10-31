# Final review: initial state and first isolated correction

Audit baseline: c2faaed855cc7985c4f4d76ad342f68a0ae022f8, production version 179.
GitHub main and Claude's integrated design baseline: 1bec80e.
Working branch: audit/final-reliability-review. No merge or deployment authorized.
The owner confirmed the UI redesign is finished and available for review.

## Verified findings

1. High: reliability implementation and CI differ between production source
   and GitHub main. Main installs requirements.txt directly; production source
   uses uv sync --frozen and contains release:check and benchmark-physics.py.
   This is unpublished source divergence, not absent implementation.
2. High: release validation accepted arbitrary JSON objects and could skip an
   absent entries map. Corrected with schema/index checks, route-specific
   structural checks, and bounded gzip expansion. Partial sessions remain valid
   when they explicitly supply empty collections; empty is never converted to zero.
3. High operational gap: capture locks are exclusive filesystem locks, not
   distributed locks. They have no owner metadata. Abrupt process termination
   bypasses finally and can leave a persistent lock. No unsafe age-based
   recovery was added. Recovery and all cross-language writers need review.
4. Durability gap: replacement uses a temporary file beside the target, but
   does not explicitly synchronize the file or directory. Atomic visibility is
   not evidence of power-loss durability. Disk-full/kill/power-loss tests remain.

## Actual verification in this batch

- Three new regression tests passed: malformed/future indexes, structurally
  invalid API/lap payloads, corrupt gzip/JSON, and excessive expansion.
- The strengthened gate passed all 959 referenced production payloads.
- Production metadata was read; no production mutation was performed.
- Baseline b799735 is available locally; the benchmark was not rerun in this batch.
- No open PR was returned by the connected GitHub open-PR query.
- Actual GitHub CI run outcomes have not yet been independently verified.
- Browser, visual, accessibility, Figma, real-session numerical and motion
  passes have not yet been executed as part of this new review.

## Design references started, not completed

Apple's Designing for macOS page, WWDC26 Platforms State of the Union, and
WWDC26 Modernize your AppKit app were located at the requested official URLs.
The latter includes Liquid Glass updates in macOS 27. This is not evidence of
pixel-perfect web fidelity or official animation constants. Figma kit access
and component-by-component comparison remain pending.

## Readiness

Not ready for a final production-readiness sign-off. This is an initial report,
not completion of the thirteen-stage brief. Keep changes isolated until the
critical recovery/provenance/CI review is complete and merge approval is given.
