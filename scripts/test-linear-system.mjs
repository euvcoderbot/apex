// Safeguards for the one Linear design system (docs/linear-design-spec.md, docs/linear-migration-audit.md §3).
// They stop the drift that produced the half-Linear look: version sections stacked on each other, extra cascade layers,
// values from outside the spec's scales, decorative gradients and capitals.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {UI_LAYERS, UI_STYLES, LOCAL_STYLES} from '../lib/ui-style-build.mjs';
import {skinRules} from './legacy-css.mjs';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const files = [...new Set([...UI_STYLES, ...LOCAL_STYLES].map(([file]) => file))];
// skins.css is checked without its generated base block (the retired files' looks, moved there with zero specificity).
const css = Object.fromEntries(files.map(f => [f, f === 'skins.css' ? skinRules(read(f)) : read(f)]));
// Comments say why a rule exists; the checks look at declarations only.
const code = text => text.replace(/\/\*[\s\S]*?\*\//g, '');
const offenders = (re, only = files) => only.flatMap(f => code(css[f]).split('\n').map((line, i) => re.test(line) ? `${f}:${i + 1} ${line.trim().slice(0, 120)}` : null).filter(Boolean));

test('the cascade has exactly these layers and skins.css is the last one', () => {
  assert.deepEqual(UI_LAYERS, ['focus', 'tokens', 'legacy', 'interface', 'workspace', 'appearance', 'components', 'window', 'system', 'skin'],
    'Do not add a cascade layer: change the rule that owns the look in skins.css (AGENTS.md, Linear design system).');
  assert.deepEqual(UI_STYLES.at(-1), ['skins.css', 'skin']);
});

test('no stylesheet is organised in version sections', () => {
  const banners = files.flatMap(f => (css[f].match(/\/\*[^*]*\bv[3-9](?:\.\d+)?\b[^*]*\*\//g) || []).map(b => `${f}: ${b.slice(0, 80)}`));
  assert.deepEqual(banners, [], 'Edit the rule that owns the look instead of appending a new version section.');
});

test('one token block: the Linear tokens are defined once per theme in skins.css', () => {
  const skins = code(css['skins.css']);
  for (const token of ['--linear-rail', '--lin-card', '--lin-card-border', '--lin-pill', '--lin-nav-active', '--lin-nav-hover']) {
    // Top-level blocks only: a media query may resize the frame (phones), which is not a second definition.
    const dark = skins.match(new RegExp(`(?:^|\\n):root\\[data-skin="linear"\\]\\s*\\{[^}]*${token}:`, 'g')) || [];
    assert.equal(dark.length, 1, `${token} is defined ${dark.length} times for the dark theme in skins.css`);
  }
  for (const f of files.filter(f => f !== 'skins.css'))
    assert.doesNotMatch(code(css[f]), /--(?:linear|lin)-[a-z-]+\s*:/, `${f} redefines a Linear token; tokens live in skins.css`);
});

test('font weights are the app\'s 450, 500 and 600', () => {
  const bad = offenders(/font-weight:\s*(?!(?:450|500|600|inherit|var\(|100 900)\b)\d+|(?:^|[\s;{])font:\s*(?!(?:450|500|600)\s)\d{3}\s/);
  assert.deepEqual(bad, []);
});

test('no capitals by transform', () => {
  assert.deepEqual(offenders(/text-transform:\s*uppercase/), [], 'Labels and units are sentence case (spec §2).');
});

test('no decorative gradients or glows in the Linear stylesheets', () => {
  // Allowed: the team-colour disc behind a driver's photo (identity), and the half-filled "next" status glyph.
  const allow = /season-avatar\.is-lg \{|season-status\[data-status="next"\]::before|data-analysis-view="performance"\]::before/;
  const linear = ['skins.css', 'season.css', 'live-linear.css'];
  const bad = offenders(/(?:linear|radial|conic)-gradient\(|drop-shadow\(/, linear).filter(l => !allow.test(l));
  assert.deepEqual(bad, [], 'Surfaces are flat (spec §1); a gradient or glow needs a data reason and an entry in this allow-list.');
});

test('specificity hacks do not grow', () => {
  // Repeating [data-skin] to win a fight inside the skin layer means two rules own one look. The count may only go down.
  const count = Object.values(css).reduce((n, t) => n + (code(t).match(/\[data-skin\]\[data-skin\]/g) || []).length, 0);
  assert.ok(count <= 21, `${count} doubled [data-skin] selectors (limit 21): merge the competing rules instead of adding weight`);
});
