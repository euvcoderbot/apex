// Generates the colour tokens of an alternative look ("skin") from that design system's own colour tokens, so the look uses the
// system's real values and variants rather than approximations. The Linear palette below is Linear's published token set, read from
// linear.app's stylesheet on 2026-11-05 (the --color-* custom properties under [data-theme="dark"] / [data-theme="light"]), plus the
// brand colours on linear.app/brand. See docs/linear-look.md. The accent is the site's own turquoise (black and turquoise are
// the house colours, 2026-11-14), in place of Linear's indigo; contrast is met the same way.
//
// Each of the app's tokens maps to one Linear token. Only two kinds of change are made, and both are listed in ADJUSTED:
//   - a colour that fails WCAG AA where the app uses it as text, or behind white text, keeps its hue and chroma and moves in OKLCH
//     lightness just far enough to pass (Linear's light-theme indigo #7070ff is 3.85:1 with white; the app needs 4.5:1);
//   - the high-contrast theme (prefers-contrast: more) pulls the dimmer text tiers toward the label colour and strengthens borders.
//
//   node scripts/generate-skin.mjs            rewrites the generated block in skins.css
//   node scripts/generate-skin.mjs --check    fails if skins.css is out of date
import {readFileSync, writeFileSync} from 'node:fs';

export const SKINS = {
  linear: {
    // Dark: verified in the signed-in Linear app (2026-11-10; docs/linear-design-spec.md §1). Light: Linear's published tokens.
    dark: {
      'bg-level-0': '#09090a', 'bg-panel': '#121213', 'bg-level-2': '#191a1b', 'bg-secondary': '#1b1c1d', 'bg-tertiary': '#232325',
      'bg-quaternary': '#29292b', 'bg-translucent': '#ffffff0d', 'border-secondary': '#28282b', 'border-translucent': '#ffffff0d',
      'border-translucent-strong': '#ffffff14', 'text-primary': '#ffffff', 'text-secondary': '#e3e4e6', 'text-tertiary': '#959597',
      'text-quaternary': '#565759', 'brand-bg': '#14b8a6', accent: '#2dd4bf', 'accent-tint': '#0f2624', 'link-primary': '#5eead4',
      green: '#27a644', red: '#eb5757', yellow: '#f0bf00', 'overlay-primary': '#000000d9',
    },
    light: {
      'bg-level-0': '#ffffff', 'bg-panel': '#ffffff', 'bg-secondary': '#f9f8f9', 'bg-tertiary': '#f4f2f4', 'bg-quaternary': '#eeedef',
      'bg-quinary': '#e9e8ea', 'bg-translucent': '#00000005', 'border-tertiary': '#dcdbdd', 'border-translucent': '#0000000d',
      'border-translucent-strong': '#00000014', 'text-primary': '#282a30', 'text-secondary': '#3c4149', 'text-tertiary': '#6f6e77',
      'text-quaternary': '#86848d', 'brand-bg': '#14b8a6', accent: '#14b8a6', 'accent-tint': '#e8faf7', 'link-primary': '#0d9488',
      green: '#27a644', red: '#eb5757', yellow: '#f0bf00', 'overlay-primary': '#ffffffa6',
    },
  },
};

// ---------- Colour maths (CSS Color 4 OKLab matrices) ----------
const toLinear = v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
const toGamma = v => { const x = Math.min(1, Math.max(0, v)); return x <= .0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - .055; };
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);

export function hexToOklch(hex) {
  const [r, g, b] = rgb(hex).map(toLinear);
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b), m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b), s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  const L = .2104542553 * l + .7936177850 * m - .0040720468 * s, A = 1.9779984951 * l - 2.4285922050 * m + .4505937099 * s, B = .0259040371 * l + .7827717662 * m - .8086757660 * s;
  return {l: L, c: Math.hypot(A, B), h: (Math.atan2(B, A) * 180 / Math.PI + 360) % 360};
}

export function oklchToHex({l, c, h}, alpha = 1) {
  const a = c * Math.cos(h * Math.PI / 180), b = c * Math.sin(h * Math.PI / 180);
  const l_ = (l + .3963377774 * a + .2158037573 * b) ** 3, m_ = (l - .1055613458 * a - .0638541728 * b) ** 3, s_ = (l - .0894841775 * a - 1.2914855480 * b) ** 3;
  const lin = [4.0767416621 * l_ - 3.3077115913 * m_ + .2309699292 * s_, -1.2684380046 * l_ + 2.6097574011 * m_ - .3413193965 * s_, -.0041960863 * l_ - .7034186147 * m_ + 1.7076147010 * s_];
  const hex = lin.map(toGamma).map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  return '#' + hex + (alpha < 1 ? Math.round(alpha * 255).toString(16).padStart(2, '0') : '');
}

// WCAG contrast of two opaque hex colours.
export function contrastRatio(x, y) {
  const lum = hex => { const [r, g, b] = rgb(hex).map(toLinear); return .2126 * r + .7152 * g + .0722 * b; };
  const [a, b] = [lum(x), lum(y)].sort((p, q) => q - p);
  return (a + .05) / (b + .05);
}

// The least change in OKLCH lightness (hue and chroma kept) that gives `min` contrast against every colour in `against`.
export function meetContrast(hex, against, min, direction) {
  if (against.every(other => contrastRatio(hex, other) >= min)) return hex;
  const start = hexToOklch(hex);
  for (let step = 1; step <= 200; step++) {
    const next = oklchToHex({...start, l: Math.min(1, Math.max(0, start.l + direction * step * .0025))});
    if (against.every(other => contrastRatio(next, other) >= min)) return next;
  }
  throw new Error(`no lightness of ${hex} reaches ${min}:1`);
}

const alpha = (hex, factor) => hex.slice(0, 7) + Math.min(255, Math.round(parseInt(hex.slice(7, 9) || 'ff', 16) * factor)).toString(16).padStart(2, '0');
const mix = (from, to, amount) => '#' + rgb(from).map((v, i) => Math.round((v + (rgb(to)[i] - v) * amount) * 255).toString(16).padStart(2, '0')).join('');

// ---------- Linear token -> app token ----------
export function generate(p, {theme, highContrast = false}) {
  const dark = theme === 'dark';
  // Inverted L: the frame (sidebar, toolbar) is the base level, the content one raised panel. Linear's app is darker outside and lighter
  // inside in dark mode, and grey outside with white content in light mode.
  const frame = dark ? p['bg-level-0'] : p['bg-secondary'], panel = p['bg-panel'];
  const well = dark ? p['bg-level-2'] : p['bg-secondary'];
  const control = dark ? p['bg-secondary'] : p['bg-tertiary'], hover = dark ? p['bg-tertiary'] : p['bg-quaternary'];
  const selected = dark ? p['bg-quaternary'] : p['bg-quinary'];
  const surfaces = [frame, panel, control];
  const ink = dark ? '#ffffff' : '#000000', dir = dark ? 1 : -1;
  let text = [p['text-primary'], p['text-secondary'], p['text-tertiary'], p['text-quaternary']];
  let [border, strong, separator] = [p['border-translucent-strong'], dark ? p['border-secondary'] : p['border-tertiary'], p['border-translucent']];
  if (highContrast) {
    text = [text[0], ...text.slice(1).map(t => mix(t, text[0], .4))];
    [border, separator] = [alpha(border, 1.75), alpha(separator, 1.75)];
    strong = mix(strong, text[2], .35);
  }
  // Text roles must pass AA where the app sets them on its surfaces; fills behind white text must pass with white.
  text = text.map((t, i) => i < 3 ? meetContrast(t, surfaces, i ? 4.5 : 7, dir) : t);
  const action = meetContrast(p['brand-bg'], ['#ffffff'], 4.5, -1);
  const accent = meetContrast(dark ? p.accent : p['link-primary'], [panel, well, p['accent-tint']], 4.5, dir);
  const status = name => meetContrast(p[name], [panel, control], 4.5, dir);
  return {
    '--ui-canvas': frame, '--ui-sidebar': frame, '--ui-toolbar': frame, '--ui-panel': panel, '--ui-content': panel,
    '--ui-well': well, '--ui-header-row': well, '--ui-control': control, '--ui-control-hover': hover, '--ui-selected': selected,
    '--ui-seg-track': dark ? p['bg-translucent'] : p['border-translucent'], '--ui-seg-thumb': dark ? p['border-translucent-strong'] : p['bg-level-0'],
    '--ui-label': text[0], '--ui-secondary': text[1], '--ui-tertiary': text[2], '--ui-quaternary': text[3],
    '--ui-border': border, '--ui-border-strong': strong, '--ui-separator': separator,
    '--ui-row-alt': alpha(p['bg-translucent'], dark ? .4 : 1), '--ui-row-hover': dark ? p['bg-translucent'] : p['border-translucent'],
    '--ui-accent': accent, '--ui-action': action, '--ui-selection': action,
    // Accent-on-tint controls use Linear's accent tint; neutral pressed states (toolbar, disabled) stay grey, as Linear's do.
    '--ui-selection-tint': p['accent-tint'], '--ui-selection-muted': dark ? p['border-translucent-strong'] : p['border-translucent'],
    '--ui-list-selected': dark ? p['border-translucent-strong'] : p['border-translucent'], '--ui-list-selected-label': text[0], '--ui-list-selected-secondary': text[1],
    '--ui-tile-on': action, '--ui-tile-on-label': '#ffffff',
    '--ui-positive': status('green'), '--ui-negative': status('red'), '--ui-warning': dark ? p.yellow : meetContrast(p.yellow, [panel, control], 4.5, -1),
    '--lin-overlay': p['overlay-primary'],
    '--scroll-thumb': ink + '1a', '--scroll-thumb-hover': ink + '33',
  };
}

// Which app tokens differ from the Linear token they map to, and why: printed into skins.css so the deviations stay visible.
export function adjusted(name) {
  const notes = [];
  for (const [theme, palette] of Object.entries(SKINS[name])) {
    const out = generate(palette, {theme});
    const sources = {'--ui-label': 'text-primary', '--ui-secondary': 'text-secondary', '--ui-tertiary': 'text-tertiary', '--ui-action': 'brand-bg',
      '--ui-accent': theme === 'dark' ? 'accent' : 'link-primary', '--ui-positive': 'green', '--ui-negative': 'red', '--ui-warning': 'yellow'};
    for (const [token, source] of Object.entries(sources)) if (out[token] !== palette[source]) notes.push(`${theme} ${token}: Linear ${source} ${palette[source]} -> ${out[token]} (WCAG AA)`);
  }
  return notes;
}

const css = () => {
  const out = ['/* GENERATED by scripts/generate-skin.mjs from Linear\'s own colour tokens; edit the palette there, not these values. */'];
  for (const [name, themes] of Object.entries(SKINS)) {
    const notes = adjusted(name);
    if (notes.length) out.push(`/* Adjusted for contrast:\n${notes.map(n => '   ' + n).join('\n')} */`);
    for (const [theme, palette] of Object.entries(themes)) {
      const selector = theme === 'dark' ? `:root[data-skin="${name}"]:not([data-theme="light"])` : `:root[data-skin="${name}"][data-theme="light"]`;
      const tokens = generate(palette, {theme}), strong = generate(palette, {theme, highContrast: true});
      out.push(`${selector} {\n${Object.entries(tokens).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}`);
      const changed = Object.entries(strong).filter(([k, v]) => tokens[k] !== v);
      out.push(`@media (prefers-contrast: more) {\n  ${selector} {\n${changed.map(([k, v]) => `    ${k}: ${v};`).join('\n')}\n  }\n}`);
    }
  }
  return out.join('\n');
};

const START = '/* <generated-skin-tokens> */', END = '/* </generated-skin-tokens> */';
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const file = new URL('../skins.css', import.meta.url);
  // Compare and write with LF; a Windows checkout may hold the file with CRLF line endings.
  const source = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const next = source.slice(0, source.indexOf(START) + START.length) + '\n' + css() + '\n' + source.slice(source.indexOf(END));
  if (process.argv.includes('--check')) {
    if (next !== source) { console.error('skins.css is out of date: run node scripts/generate-skin.mjs'); process.exit(1); }
    console.log('skins.css is up to date');
  } else { writeFileSync(file, next); console.log('skins.css regenerated'); }
}
