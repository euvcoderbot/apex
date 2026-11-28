> Historical note on surface/weight overrides: for F1 Apex Data's normative implementation rules (the signed-in app's 244 px rail, 450/500/600 weights, and Apex-specific surfaces), `docs/linear-design-spec.md` and `docs/linear-components.md` win where values differ. This document is the complete Linear design, animation, and layout reference gathered from Linear's live stylesheets, embedded product demo, and published engineering essays.

# Linear design reference

Everything Linear has published about its design, plus what `linear.app` itself runs in production CSS, in one place: the reference for every visual, motion, and layout decision on this site. Read it before any UI work, alongside [linear-design-spec.md](linear-design-spec.md) (normative Apex rules), [linear-components.md](linear-components.md) (how to build each element here), and [linear-look.md](linear-look.md) (how the look is wired into `skins.css`).

- **Raw tokens:** [`design/linear-tokens.json`](../design/linear-tokens.json), custom properties declared on `:root`, `[data-theme="dark"]`, and `[data-theme="light"]`. Refresh with `node scripts/fetch-linear-tokens.mjs` and review the diff.
- **Sources inspected:**
  - Live stylesheets on `linear.app/homepage`, `/features`, `/brand`, and `/now/*` (read 2026-11-28: **78 unique CSS sheets, 873 KB total CSS**, 60 non-grid `@keyframes`, 105 transition rules, 164 animation declarations, 26 timing functions, 831 non-hashed custom properties, and the embedded homepage product replica); earlier 46-sheet token capture (2026-11-09) and signed-in web app capture (2026-11-10, workspace `apexdata`, Chrome dark theme, 1043×959).
  - *Invisible details – Building contextual menus*, Andreas Eldh, 2020-09-17.
  - *A design reset (part I)*, Karri Saarinen, 2024-03-27.
  - *How we redesigned the Linear UI (part II)*, Karri Saarinen, Yann-Edern Gillet, Andreas Eldh, Romain Cascino, 2024-03-28.
  - *Design for the AI age*, Karri Saarinen, 2025-04-07.
  - *Mobile app redesign* (Changelog, 2025-10-16) & *A Linear spin on Liquid Glass*, Robb Böhnke, 2025-10-21.
  - *A calmer interface for a product in motion*, Charlie Aufmann and Maxime Heckel, 2026-03-12.
  - Linear documentation (`linear.app/docs`: Display options, Filters, Command menu, Themes, Selection, Insights, Dashboards, Triage) and `linear.app/brand`.
- Linear's logo, wordmark, icon, and illustrations are proprietary (`linear.app/brand`): never used here. This site borrows the design language, interaction craft, and architecture, not the brand.

---

## 1. Principles & Design Evolution (2020 → 2026)

Paraphrased from Linear's engineering and design essays, with what each means here.

| Principle & Era | What Linear says | What it means here |
| --- | --- | --- |
| **Invisible details & Euclidean speed** (2020) | Speed is felt in saved friction: diagonal submenu safe-triangle polygons, keyboard shortcuts shown inside context menus (`C`, `⌘⇧M`), instant tooltip chaining. | Optimize frequent flows for zero hesitation; show shortcuts inline without cluttering the chrome. |
| **The inverted L** (2024) | Sidebar and top chrome sit on the base canvas; the active workspace is one raised panel controlled by them. Navigation buttons/tabs remain detachable between Electron and web browsers. | The rail and location header frame one raised content panel (`skins.css`, frame section). |
| **Felt alignment** (2024) | Labels, icons, and buttons in the sidebar and tabs aligned both vertically and horizontally: *"not something you'll immediately see, rather something you'll feel after a few minutes."* | Every row in a list has identical height and left edge; icon and text centres align; numbers use `tabular-nums` and right-alignment. |
| **Themes from 3 variables in LCH** (2024) | Replaced ~98 hardcoded variables per theme with **Base color, Accent color, and Contrast (30–100)** in perceptually uniform **LCH** so light, dark, and accessible high-contrast themes share one model. | Our palette derives directly from Linear's tokens; `prefers-contrast: more` increases text/border contrast like Linear's contrast slider. |
| **Workbench for AI, not generic chat** (2025) | Chat alone is weak and imprecise. Traditional structured UI acts as a *workbench* giving context, constraints, and human-in-the-loop review for agents. | Keep structured tables, traces, and inspectors first-class; never replace analytical UI with conversational wrappers. |
| **ProKit, not consumer Aqua** (2025) | *A Linear spin on Liquid Glass*: take depth, subtle lighting, and tactile physics, but reject pixel refraction because it degrades legibility in dense professional workflows. | No refraction or heavy blur over dense data/charts. High-contrast mode switches translucent rings to solid outlines. |
| **Don't compete for attention you haven't earned** (2026) | Dimmed sidebar navigation a few notches so content owns focus; made desktop tabs compact with rounded corners instead of spanning full width; scaled icons down and removed colored team icon backgrounds. | Rail and headers stay in tertiary/nav text with quaternary icons. Data (traces, numbers) carries the contrast. Team colour marks identity only. |
| **Structure should be felt, not seen** (2026) | Dividing lines had proliferated; soften border contrast, round edges, and drop redundant separators so spacing and elevation organize the page. | Prefer whitespace and a subtle card ring over divider lines. One hairline at most between groups; never a border inside a bordered card. |
| **Neutral, warm-balanced & pruned** (2024, 2026) | Reduced cool blue chrome toward crisper, less-saturated warmer neutrals (careful not to go muddy); standardized header action placement across all views; validated live via an internal dev toolbar + Figma token sync. | Neutrals stay near-grey; accent marks primary actions, focus, active selection, and links. Keep toolbar actions in fixed positions across routes. |

---

## 2. Colour

Linear's two themes, exactly as published (`design/linear-tokens.json`). **Bold** = what this site uses for that role.

### Surfaces

| Token | Dark | Light | Role here |
| --- | --- | --- | --- |
| `bg-level-0` / `bg-primary` | `#08090a` | `#ffffff` | **canvas** (frame behind the rail) in dark |
| `bg-level-1` / `bg-panel` | `#0f1011` | `#f8f8f8` | **raised content view** (`--ui-panel`) |
| `bg-level-2` / `bg-tint` | `#141516` | `#f4f4f4` | wells, inputs |
| `bg-level-3` | `#191a1b` | `#f0f0f0` | hover on a well |
| `bg-secondary` | `#1c1c1f` | `#f9f8f9` | menus, popovers; light canvas |
| `bg-tertiary` | `#232326` | `#f4f2f4` | control hover |
| `bg-quaternary` | `#28282c` | `#eeedef` | selected control |
| `bg-quinary` | `#282828` | `#e9e8ea` | pressed |
| `bg-translucent` | `#ffffff0d` | `#00000005` | faint fills on any surface |
| `bg-marketing` | `#010102` | — | marketing pages only |
| floating menu surface / highlight / pressed | `#08090ae6` / `#ffffff14` / `#ffffff21` | `#ffffffe6` / `#0000000d` / `#00000017` | blurred dropdown & context menus (`blur(20px)`–`blur(32px)`) |

### Text and foreground

| Tier | Dark | Light | Use |
| --- | --- | --- | --- |
| primary | `#f7f8f8` | `#282a30` | titles, data, selected rows |
| secondary | `#d0d6e0` | `#3c4149` | body, values, row labels |
| tertiary | `#8a8f98` | `#6f6e77` | labels, metadata, inactive nav |
| quaternary | `#62666d` | `#86848d` | axes, hints, placeholders, icons at rest |

### Lines and borders

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `border-translucent` | `#ffffff0d` | `#0000000d` | **hairlines** inside the view |
| `border-translucent-strong` | `#ffffff14` | `#00000014` | **card rings**, header border, frame |
| `border-primary` | `#23252a` | `#e9e8ea` | opaque divider |
| `border-secondary` | `#34343a` | `#e4e2e4` | control border |
| `border-tertiary` | `#3e3e44` | `#dcdbdd` | label pills (`--lin-label-border`) |
| `line-primary` … `line-quaternary` (2026) | `#37393a #202122 #18191a #141515` | `#d4d4d6 #eaeaeb #f0f0f0 #f4f4f4` | the softened separators: secondary for list separators, tertiary/quaternary for barely-there structure |
| `line-tint` | `#141516` | `#f4f4f5` | tinted separators |

### Accent, brand and status

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `brand-bg` | `#5e6ad2` | `#7070ff` | primary button fill (light darkened here to `#6563f1` for 4.5:1 white text) |
| `accent` | `#7170ff` | `#7170ff` | accent text, focus, active indicators |
| `accent-hover` | `#828fff` | `#8989f0` | hover on accent |
| `accent-tint` | `#18182f` | `#f1f1ff` | accent-tinted backgrounds (mention chips, selected accent buttons) |
| `link-primary` / hover | `#828fff` / `#fff` | `#7070ff` / text primary | links |
| selection | brand mixed 10% black (dark), brand at 36% (light) | | text selection |
| `button-invert-bg` | `#e5e5e6` (hover `#fff`) | `#282a30` (hover `#1f2024`) | the high-emphasis inverted button ("Sign up") |
| red / green / yellow / orange | `#eb5757` / `#27a644` / `#f0bf00` / `#fc7840` | same (darkened here in light for contrast) | loss / gain / warning / attention |
| indigo / teal / blue | `#5e6ad2` / `#00b8cc` / display-p3 `.431 .682 .999` | | spare categorical colours |
| overlay | `#000000d9` | `#ffffffa6` | dialog backdrop |
| brand neutrals | Nordic Gray `#232326` (earlier `#222326`) | Mercury White `#F7F8F8` (earlier `#F4F5F8`) | brand guidelines only; not used directly in the app |

**Rules.** Colour never carries hierarchy (tiers do). The accent is rare. Team colours mark identity only (a dot, a line, a
swatch), never selection or state. Translucent white/black for hover (`~2–4%`), selected (`~4–8%`), and rings (`5–8%`). Linear
never uses pure `#000000` on main surfaces (even the darkest canvas stays near-black `#08090a` / `#09090a` with subtle LCH hue 272), and computes text selection via `color-mix(in lch, var(--color-brand-bg), ...)`.

---

## 3. Typography & Optical Craft

- **Primary UI & Display:** `"Inter Variable", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Open Sans", "Helvetica Neue", sans-serif` (served from `InterVariable.woff2?v=4.1` and `InterVariable-Italic.woff2?v=4.1`, `font-weight: 100 900`, `font-display: swap`).
  - OpenType features: `font-feature-settings: "cv01", "ss03"` (`--font-settings`), `font-variation-settings: "opsz" auto` (`--font-variations` so Display proportions kick in automatically at heading sizes), `-webkit-font-smoothing: antialiased`.
- **Monospace:** `"Berkeley Mono", ui-monospace, "SF Mono", "Menlo", monospace` (`Berkeley-Mono-Variable.woff2?v=3.2`), OpenType features `"cv01", "ss02"` (`--font-monospace-settings`), `font-variation-settings: normal`.
- **Editorial serif (marketing only):** `"Tiempos Headline", ui-serif, Georgia, Cambria, "Times New Roman", Times, serif`.
- **Numerical discipline:** `font-variant-numeric: tabular-nums lining-nums` on tables, timestamps, timelines, diffs, and charts.
- **Optical cap-height trimming:** `text-box: trim-both cap alphabetic` (wrapped in `@supports (text-box: trim-both cap alphabetic)`) on card metadata, section titles, and compact headers so text sits optically centred inside tight containers.
- **Links & underlines:** `text-decoration-thickness: from-font` (`clamp(1px, .0625em, 3px)` fallback), `text-underline-offset: clamp(2px, .175em, 4px)`, underline colour `--color-text-quaternary` transitioning to `--color-text-primary` on `@media (any-hover: hover)` over `var(--speed-regularTransition)`.

**Weights:** `300` light · `400` normal (`450` in signed-in app) · `510` medium (`500` in signed-in app) · `590` semibold (`600` in signed-in app) · `680` bold (unused in UI chrome).

**Named size tokens:** `micro` `.6875rem` (11 px) · `mini` `.75rem` (12 px) · `small` `.8125rem` (13 px) · `regular` `.9375rem` (15 px) · `large` `1.125rem` (18 px) · `title3` `1.25rem` (20 px) · `title2` `1.5rem` (24 px) · `title1` `2.25rem` (36 px). *(Inside the embedded app replica, sizes shift slightly: `micro` `.75rem` / 12 px, `mini` `.8125rem` / 13 px, `small` `.875rem` / 14 px, `regular` `1rem` / 16 px.)*

**Text styles** (`size / line height / letter spacing`):

| Style | Value | Use here |
| --- | --- | --- |
| `text-tiny` | 10 px (`.625rem`) / `1.5` / `-.015em` | tiny badges only |
| `text-micro` | 12 px (`.75rem`) / `1.4` / `0` | labels, captions, table headers, values in dense lists |
| `text-mini` | 13 px (`.8125rem`) / `1.5` / `-.01em` | **base UI text** (rows, buttons, inputs) |
| `text-small` | 14 px (`.875rem`) / `calc(21 / 14)` / `-.013em` | longer UI text, sidebar navigation buttons |
| `text-regular` | 15 px (`.9375rem`) / `1.6` / `-.011em` | prose, descriptions, editor body (`1.6`, `-.00666667em` in editor) |
| `text-large` | 17 px (`1.0625rem`) / `1.6` / `0` | lead paragraphs |
| `title-1` | 590 17 px (`1.0625rem`) / `1.4` / `-.012em` | small headings |
| `title-2` | 590 20 px (`1.25rem`) / `1.33` / `-.012em` | **page and section titles** |
| `title-3` | 590 24 px (`1.5rem`) / `1.33` / `-.012em` | big figures, hero titles |
| `title-4` … `title-9` | 590 32 / 40 / 48 / 56 / 64 / 72 px, `-.022em` | marketing; not used in the app |

**Inline `<kbd>` & `<code>` chips:**
- `<kbd>`: `min-width: 24px` (or `16–20px` inside buttons/menus), `padding: 3px 6px` (`0 4px` compact), `border-radius: 5px` (`3px` inside command menu), `font-size: .8em` (or `11px` in command menu), `font-weight: medium`, `box-shadow: var(--shadow-tiny), 0 0 0 1px var(--color-border-tertiary)`, `kbd:first-letter { text-transform: uppercase }`.
- Inline `<code>`: `background: var(--color-bg-secondary)`, `border: 1px solid var(--color-border-secondary)`, `border-radius: .3em`, `padding: .1em .25em`, `font-size: .875em`, `line-height: 1.3`, `box-decoration-break: clone`.

---

## 4. Shape, Depth, Layout, Breakpoints & Layers

### Radii, hairlines & concentric nesting
- **Radius scale:** `4` · `6` · `8` · `12` · `16` · `24` · `32` · `9999` (`--radius-rounded`) · `50%` (`--radius-circle`).
- **Concentric nesting rule:** Outer app shell `--app-radius: 12px` with `--frame-padding: 8px` produces an inner panel radius of `calc(var(--app-radius) - 4px)` (`8px`; signed-in app uses `21px` dialog outer / `12px` inner, `12px` panel, `10px` cards, `8px` controls).
- **Retina hairlines:** `--border-hairline: 1px` at 1×, dropping to `.5px` inside `@media only screen and ((min-device-pixel-ratio: 2) or (-webkit-min-device-pixel-ratio: 2)), only screen and ((min-device-pixel-ratio: 2) or (min-resolution: 192dpi))`.
- **Rings & shadows (dark):** low `0 2px 4px #0000001a`; medium `0 4px 24px #0003`; high `0 7px 32px #00000059`; cards use flat inset rings (`inset 0 0 0 1px #ffffff14` + outer `0 0 0 1px #0003` or `#ffffff08`/`#ffffff0a` top edge); dialogs use layered elevation `0 4px 40px #0000001a, 0 3px 20px #00000020, 0 3px 12px #00000020, 0 2px 8px #00000020, 0 1px 1px #00000020`.
- **Shadows (light):** tiny `0 1px 1px #00000017`; low `0 1px 4px -1px #00000017`; medium `0 3px 12px #00000017`; high `0 7px 24px #0000000f`; dialogs `0 9px 48px #00000014, 0 6px 24px #0000001a, 0 1px 1px #0000000a`.
- **Stacked button shadow (`--shadow-stack-low`):** 5-layer micro-shadow (`0 8px 2px #0000, 0 5px 2px #00000003, 0 3px 2px #0000000a, 0 1px 1px #00000012, 0 0 1px #00000014`; light mode adds `0 -1px 1px 0 #0000001c inset` on inverted buttons).

### Z-index layer hierarchy (`:root`)
Keep floating elements strictly in this order:
`1–3` (`--layer-1..3`, local content stacking) → `50` (`footer`) → `75` (`scrollbar`) → `100` (`header`) → `500` (`overlay`) → `600` (`popover`) → `650` (`command-menu`) → `699` (`dialog-overlay`) → `700` (`dialog`) → `800` (`toasts`) → `1100` (`tooltip`) → `1200` (`context-menu`) → `5000` (`skip-nav`) → `10000` (`max`) → `11000` (`debug`).

### Layout grid, breakpoints & optical positioning
- **Layout modes in the Linear product:** *List*, *Board*, *Timeline*, *Split* (list + detail side-by-side), and *Fullscreen*, plus a *Peek* preview drawer and collapsible right *Properties* inspector.
- **Website/shell responsive breakpoints measured in `linear.app` CSS:**
  - Mobile: `<= 640px` (`--grid-columns: 4`, header height `64px`, `--homepage-outer-padding: 16px`, touch `--min-tap-size: 44px`).
  - Tablet: `<= 768px` (and `<= 700px` / `<= 928px` intermediate layout collapses).
  - Laptop: `<= 1024px` (`--grid-columns: 8`, `--homepage-outer-padding: 28px`, `--homepage-padding-inset: 8px`).
  - Desktop: `<= 1280px` / `> 1280px` / `>= 1536px` (`--grid-columns: 12`, `--grid-gap: 32px`, `--page-max-width: 1024px`, `--prose-max-width: 624px`, `--homepage-max-width: calc(1344px + outer * 2)`).
- **Dynamic viewport & safe areas:** uses `--dvh: 1dvh` / `--svh: 1svh` (with `1vh` fallback) and `max(env(safe-area-inset-left/right), var(--page-padding-inline))`.
- **Pointer capability detection:** hover underlines, secondary reveals, and hover-only actions are gated behind `@media (any-hover: hover)` and `@media (any-hover: hover) and (any-pointer: fine)` so touch devices never get stuck hover states.
- **Optical vertical positioning (never dead-center at 50%):**
  - Command Menu (`⌘K`): `position: fixed; top: 13vh; left: 50%; transform: translate(-50%)` (`max-width: min(720px, 100vw - 32px)`, `max-height: min(73vh, 500px)`).
  - Modal Dialogs: `position: fixed; top: 33.3333%; left: 50%; transform: translate(-50%, -33.3333%)` (optical top-third).
  - Mobile Bottom Sheet (`Vaul` drawer): `inset: 5vh 0 0`, `border-radius: 30px 30px 0 0` (or snap bottom drawer with `200%` bottom overhang fill so overscroll bounce never exposes a gap).
- **Scrollbars & edge fade masks:**
  - Native custom scrollbar (`[data-custom-scrollbar]`): `12px` track (`height: 12px` horizontal), `3px` transparent border + `background-clip: content-box` creating a crisp `6px` rounded pill thumb (`#ffffff1a` dark / `#0000001a` light, brightening to `20–30%` on hover and `30–40%` active).
  - Overlay scrollbar (`AWsA3W`): `opacity: 0` at rest, `1` when `[data-scrolling]`, `transition: width .12s, height .12s, opacity .12s`; grows `9px → 14px (active) → 19px (hover)` with `44px` touch / `12px` pointer hit expansion.
  - Scroll edge masks: horizontal/vertical scrollports apply `mask-image: linear-gradient(to bottom/right, transparent 0%, #0003 calc(size/2), black size, black calc(100% - end), #0003 calc(100% - end/2), transparent 100%)` matched with equal `scroll-padding` and `overscroll-behavior: contain` so keyboard-focused items scroll clear of the fade.

---

## 5. Motion, Easing & Micro-interactions

Linear treats motion as spatial feedback and direct manipulation — **fast, un-bouncy, and interruptible**. Frequent actions have zero entrance delay so power users never wait on chrome.

### Duration tokens & measured timings
| Token / Component | Duration | Property / Effect |
| --- | --- | --- |
| `--speed-highlightFadeIn` | `0s` | Hover background/highlight appears **immediately** on pointer enter |
| `--speed-highlightFadeOut` | `.15s` (`150ms`) | Hover fades out smoothly on pointer leave |
| `--speed-quickTransition` | `.1s` (`100ms`) | Header anchors, mention menu enter (`scale` / opacity), small state toggles |
| `--speed-regularTransition` | `.25s` (`250ms`) | Larger layout/card surface transitions |
| Context & dropdown menus | `80ms` open / `60ms` close | `opacity: 0; transform: scale(.98)` with `ease-out-quad` |
| Combobox height resize | `80ms` | `transition: max-height 80ms` as command results filter |
| Tooltips (`_6QN9Vq`) | `120ms` (`0s` if `[data-instant]`) | `scale(.9 → 1)` + opacity, `ease-out-quad`, `transform-origin: var(--transform-origin)` |
| Disclosure chevrons & scrollbars | `120ms` (`0.12s`) | `rotate(90deg)` or `rotate(-90deg)`; scrollbar opacity/size |
| Dialog bounce feedback | `150ms` (`0.15s`) | `[data-bounce=true]`: subtle `scale(.98)` pulse at 50% (reject/confirm feedback) |
| Buttons & Rich Hover Cards | `160ms` (`0.16s`) | Buttons: `border, background-color, color, box-shadow, opacity, filter, transform`; `:active` presses to `scale(.97)`. Hover cards: `scale(.9 → 1)` (`0s` `[data-instant]`) |
| Command menu (`⌘K`) & modal dialog | `175ms` (`200ms` docs dialog) | Overlay opacity fade + panel `scale(.96 → 1)` (`.98` on content dialogs), `ease-out-quad` |
| Collapsibles & header nav slides | `180ms` (`0.18s`) | Height `0 → var(--collapsible-panel-height)` + `translateY(-8px)` (`ease-out-quad`), or directional slide `translateX(±48px)` (`ease-in-out-quad`) |
| Header dropdown container resize | `220ms` (`0.22s`) | `transition: height .22s, width .22s` morphing seamlessly between nav menus |
| Scatter / chart dot entrance | `420ms` (`0.42s`) | `opacity: 0; scale(.4) → 1`, staggered `animation-delay: calc(var(--index) * 2ms)` |
| Mobile sheet / Vaul drawer | `500ms` (`0.5s`) | `translate3d(0, 100%, 0) → (0, 0, 0)` with `cubic-bezier(.32, .72, 0, 1)` |
| Lazy image mask sweep / Video fade | `800ms` / `1000ms` | Image horizontal mask-position wipe (`150% → 0`); video opacity `0 → .6` (`ease-out-cubic`) |
| Agent activity border sweep | `2s linear infinite` | 1 px masked `background-position: 0 → 120px` shimmer on `[data-shimmer]` pills |
| Permalink target highlight | `3s` (`ease-in-out-quad`) | Hash-linked block holds highlight tint from `20%` to `80%` |

### Complete easing curve palette (all declared on `:root`)
- **Primary UI curve:** `--ease-out-quad: cubic-bezier(.25, .46, .45, .94)` (default for buttons, tooltips, menus, dialogs, collapsibles).
- **Deceleration family (`out`):** `quad (.25, .46, .45, .94)` · `cubic (.215, .61, .355, 1)` · `quart (.165, .84, .44, 1)` · `quint (.23, 1, .32, 1)` · `expo (.19, 1, .22, 1)` · `circ (.075, .82, .165, 1)`.
- **Acceleration family (`in`):** `quad (.55, .085, .68, .53)` · `cubic (.55, .055, .675, .19)` · `quart (.895, .03, .685, .22)` · `quint (.755, .05, .855, .06)` · `expo (.95, .05, .795, .035)` · `circ (.6, .04, .98, .335)`.
- **Symmetric family (`in-out`):** `quad (.455, .03, .515, .955)` · `cubic (.645, .045, .355, 1)` · `quart (.77, 0, .175, 1)` · `quint (.86, 0, .07, 1)` · `expo (1, 0, 0, 1)` · `circ (.785, .135, .15, .86)`.
- **Specialized curves:** Apple/Vaul drawer deceleration `cubic-bezier(.32, .72, 0, 1)`; SVG stroke trace `cubic-bezier(.65, 0, .35, 1)`; pixel-grid / caret blink `steps(1, end)` and `step-end`.

### Interactive patterns & "invisible details"
1. **Submenu diagonal safe-triangle (`clip-path: polygon`):** When a contextual submenu is open, Linear measures the submenu's bounding rect (`getBoundingClientRect()`) and live `[mouseX, mouseY]`, rendering an invisible triangle (`clipPath: polygon(...)`) spanning from cursor to submenu so diagonal mouse movement never prematurely closes the menu.
2. **Instant warm tooltips (`[data-instant]`):** First tooltip entry animates over `120ms`; moving directly to a sibling tooltip drops duration to `0s` so scanning a toolbar feels instantaneous.
3. **Sliding active tab pill:** Tracks `--active-tab-left`, `--active-tab-top`, `--active-tab-width`, and `--active-tab-height` and slides with `transform: translateX(var(--active-tab-left))`.
4. **Menu row inset highlight:** Menu items (`32px` tall, `padding: 0 15px`) paint their hover/active pill on `::before` inset `0 5px` (`border-radius: 8px`) so highlights never touch the outer menu border.
5. **View Transitions & Reduced Motion:** `::view-transition-old/new(root)` disables default cross-fade (`mix-blend-mode: normal; animation: none`) unless explicitly opted in; `@media (prefers-reduced-motion: reduce)` kills animations and view-transition groups globally.
6. **Liquid Glass (native mobile, 2025):** GPU SDF normal-map specular edge light (`Plus Lighter` blend) + Gaussian blur + progressive scroll-edge blur + touch lift & overscroll distortion, **without refraction**; CSS adapts edge highlights on marketing cards via radial gradient masks (`--edge-highlight-*`, `--edge-glow-*`).

---

## 6. Focus, Accessibility & Cursors

- **Focus ring:** dark `1 px solid` (`--focus-ring-color`, offset `2 px`); light `2 px solid #0006` (offset `2 px`). Measured on search/form inputs: `0 0 0 3px #5e6ad266` (brand at 40%) or `2px solid var(--color-accent)` with `2px` offset.
- **Increase contrast:** Linear draws solid outlines around translucent surfaces and pushes secondary/tertiary text toward primary (`prefers-contrast: more` here moves text 40% toward `--ui-label` and raises border opacity 1.75×).
- **Text contrast:** minimum `4.5:1` for text (`7:1` on primary labels); Linear's light accent `#7070ff` is darkened where needed to meet `4.5:1` on white.
- **Cursors:** `--pointer: default` on non-link UI controls, `--cursor-pointer: pointer` on links/menu hits, `--cursor-tooltip: help` on hover-card triggers, `--cursor-disabled: not-allowed` when disabled, `zoom-in`/`zoom-out` on expandable media.

---

## 7. Components Measured on `linear.app` & Charts

Computed styles and CSS module rules from `linear.app` (heights in px):

| Component | Exact Measurements & Rules |
| --- | --- |
| **Buttons (`S36ykG`)** | Sizes: `mini` 24 h (`0 10`, gap 4, 12 px text/icon) · `small` 32 h (`0 12`, gap 8, 13 px text, 16 px icon) · `medium` 40 h (`0 14`, gap 8) · `default` 40 h (`0 16`, gap 6, 15 px text) · `large` 44 h (`0 20`, gap 6, 16 px text). Pill radius `9999`. Variants: `primary` (`brand-bg`, hover `brightness(115%)`), `secondary` (dark `translucent` + `blur(4px)` + top inset ring `#ffffff0a`; light `#fff` + `0 0 0 1px #00000014` + `--shadow-low`), `tertiary`, `invert` (`button-invert-bg` + `--shadow-stack-low`), `ghost`, `glass` (`blur(8px)` `#ffffff29` hover), `inline`. Active press `scale(.97)`. |
| **Sidebar & nested tree (`_X0uBq`, `_4C4ecW`)** | Product demo rail `232 px` (signed-in app `244 px`); marketing docs rail rows `36 px` button / `32 px` link (`28 px` in product demo), `radius 8`, `padding 0 8 0 11`, `510` medium, icons `opacity: .45` rest → `.68` hover → `1` active. Nested subpages draw a `1 px` vertical guide at `left: 16px` (`border-tertiary`) + curved SVG branch connector (`margin-inline: 8px 10px`). |
| **Context / Dropdown menu (`_0AH76q`)** | `min-width: max(anchor-width, 175px)`, `border-radius: 14`, `padding: 5px 0`, `backdrop-filter: blur(20px)`, dark `#08090ae6` / light `#ffffffe6`, `1 px` border `#ffffff14` / `#00000014`. Rows `32 h` (`48 min-h` with description), `font-weight: 450`, `padding: 0 15`, `gap: 8`, `::before` highlight `inset: 0 5px` `radius 8`. Divider `1 px` `margin: 6px 0 5px`. |
| **Header morphing popup (`TZTsQG`)** | `backdrop-filter: blur(32px)`, `border-radius: 14`, dark `#08090ae6` / light `#ffffffe6`, `min(100vw - padding)` width, `3`-column nav grid (`256px` cols, `24px` col-gap, `1px` vertical dividers between columns), `12px` horizontal fade mask, `6px` radius inline links (`14 24 14 16`), footer changelog strip (`14 28`). |
| **Command menu (`wOrUyW`, `⌘K`)** | `max-width: min(720px, 100vw - 32px)`, `max-height: min(73vh, 500px)`, `top: 13vh`, `border-radius: 12`, `bg-level-1`, input `46 h` `padding: 0 18` `caret-color: brand-bg`, group heading `30 h` `12 px 510 tertiary`, items `46 min-h` `gap: 12`, selected row `::after` `inset: 2px 0` `radius 8` `bg-level-3`, shortcut chips `20×20` `radius 3`. |
| **Modal dialog (`PSAPAG`)** | `top: 33.3333%`, `border-radius: 12`, `bg-primary`, widths `400` / `480` / `600 px` / `max-content`, header `16 16 0`, body `6 16 16`, footer `0 16 16` (`gap: 8`). |
| **Tooltip (`_6QN9Vq`) & Hover card (`UVNdXW`)** | Tooltip: `max-width: 280`, `padding: 6 8`, `line-height: 17`, `radius 8`, `12 px 510 secondary`, `--shadow-high`. Hover card: `radius 12`, `padding: 10`, `blur(20px)`, `40 px` avatar + `text-box: trim-both`. |
| **Agent / Status pill (`-VOcTG`)** | `24 h` (`small` `22 h`), `border-radius: 9999`, `12 px 510 tertiary` (`10 px` small), `avatar 16 px` (`14 px` small) with `2 px` surface cutout ring, active `[data-shimmer]` sweeps a `1 px` masked border gradient (`2s linear infinite`). |
| **Label & Code pills** | Label pill: `~24 h`, `radius 16` / `9999`, `1 px` `#2e2e32`, `padding 0 11 0 7`, `400 12/14`, leading `8 px` colour dot. Mention chip: `radius 4`, `padding 0 3`, accent text on `#6d78d526` (15% accent). |
| **Insights / Chart plot (`fFDhtq`) & Timeline** | Chart: `1 px` dashed horizontal lines (`repeating-linear-gradient(to right, #2e2e32 0 2px, transparent 2px 6px)`), solid baseline, scatter dots `scale(.4 → 1)` over `420ms` (`2ms * index` stagger), `.5 px` percentile lines with `1px` background halo, `tabular-nums lining-nums` key (`16 h`). Timeline blocks: `24 h`, `radius 4`, `border: 1px #ffffff1f`, `inset 0 0 12px #0003`, open-ended right tail uses `0% → 20%` accent alpha wash. |
| **Code diff (`tEYzwG`)** | Added lines: `border-left-color: green`, bg `#27a64414`, token highlight `#27a6442e`. Removed lines: `border-left-color: #f34f52`, bg `#f34f5214`, token highlight `#fc31422e`. |

From Linear product docs (`Display options`, `Filters`, `Insights`, `Dashboards`, `Triage`): display controls sit top-right (`Shift+V`), filters top-left (`F`), personal display changes stay local unless set as default; dashboards pair metrics, trend charts, and breakdown tables with explicit context and separate operational vs. strategic views.

---

## 8. How this site applies it

| Linear | This site |
| --- | --- |
| Inverted L, sidebar + top bar on canvas | `#linearWorkspace` rail (240 px) + 44 px location header around one raised view (`skins.css`) |
| Sidebar rows 28 px, 510 13 px, radius 8 | rail navigation, drivers list, categories |
| Section labels 510 12 px quaternary | rail section headings |
| Views with headers for filters and display options | session selectors, Car performance scope and races, Season tabs |
| Side panel for properties | the track and corner inspector |
| List rows, hairline separators | `.performance-table`, `.season-table` |
| Cards: panel fill, ring, radius 8 | charts, lap cards, overview tiles, profile, time summary |
| Label pills | comparison laps, chart legends |
| Small controls 24–28 px | toggles, segmented controls, Change |
| Primary action in brand colour | Load session, Analyse |
| Accent tint | per-driver Fastest pick |
| Status colours | gains/losses, warnings |
| Structure felt not seen | no borders inside cards; one hairline between groups; spacing first |

Where this site needs something Linear doesn't publish (telemetry traces, bar charts, maps), it follows the same rules: hairline
grid, quaternary axes at 11 px, 510 12 px values, team colour only for identity, data in the strongest contrast.
