import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import postcss from 'postcss';
import {SKINS, generate, contrastRatio, hexToOklch} from './generate-skin.mjs';
import {skinRules} from './legacy-css.mjs';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');

test('the Linear look tokens come from Linear\'s own token set and skins.css is current', () => {
  const out = execFileSync(process.execPath, [new URL('./generate-skin.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--check'], {encoding: 'utf8'});
  assert.match(out, /up to date/);
  // Dark: the signed-in app's values (2026-11-10); light: Linear's published values. Used as they are wherever they pass contrast.
  const dark = generate(SKINS.linear.dark, {theme: 'dark'}), light = generate(SKINS.linear.light, {theme: 'light'});
  assert.deepEqual([dark['--ui-canvas'], dark['--ui-panel'], dark['--ui-well'], dark['--ui-control'], dark['--ui-control-hover'], dark['--ui-selected']],
    ['#09090a', '#121213', '#191a1b', '#1b1c1d', '#232325', '#29292b']);
  assert.deepEqual([dark['--ui-label'], dark['--ui-secondary'], dark['--ui-tertiary'], dark['--ui-quaternary']], ['#ffffff', '#e3e4e6', '#959597', '#565759']);
  // The accent is the site's turquoise (black and turquoise are the house colours), not Linear's indigo.
  assert.deepEqual([dark['--ui-accent'], dark['--ui-selection-tint'], dark['--ui-positive'], dark['--ui-negative']], ['#2dd4bf', '#0f2624', '#27a644', '#eb5757']);
  assert.deepEqual([dark['--ui-border'], dark['--ui-separator'], dark['--ui-border-strong']], ['#ffffff14', '#ffffff0d', '#28282b']);
  // Light: grey frame, white content (Linear's inverted L), and Linear's light text tiers.
  assert.deepEqual([light['--ui-canvas'], light['--ui-panel'], light['--ui-control']], ['#f9f8f9', '#ffffff', '#f4f2f4']);
  assert.deepEqual([light['--ui-label'], light['--ui-secondary'], light['--ui-tertiary'], light['--ui-quaternary']], ['#282a30', '#3c4149', '#6f6e77', '#86848d']);
  // The turquoise fails 4.5:1 with white; the action colour keeps its hue and darkens only to 4.5:1, in both themes.
  for (const theme of [dark, light]) {
    const [brand, action] = ['#14b8a6', theme['--ui-action']].map(hexToOklch);
    assert.ok(Math.abs(brand.h - action.h) < 4 && action.l < brand.l && contrastRatio('#ffffff', theme['--ui-action']) < 4.8);
  }
});

test('generated text and action colours meet WCAG contrast on their surfaces', () => {
  for (const [theme, palette] of Object.entries(SKINS.linear)) {
    for (const highContrast of [false, true]) {
      const t = generate(palette, {theme, highContrast}), label = `${theme}${highContrast ? ' high contrast' : ''}`;
      for (const surface of ['--ui-canvas', '--ui-panel', '--ui-control']) {
        assert.ok(contrastRatio(t['--ui-label'], t[surface]) >= 7, `${label} label on ${surface}`);
        assert.ok(contrastRatio(t['--ui-secondary'], t[surface]) >= 4.5, `${label} secondary on ${surface}`);
        assert.ok(contrastRatio(t['--ui-tertiary'], t[surface]) >= 4.5, `${label} tertiary on ${surface}`);
        for (const status of ['--ui-positive', '--ui-negative']) if (surface !== '--ui-canvas') assert.ok(contrastRatio(t[status], t[surface]) >= 4.5, `${label} ${status} on ${surface}`);
      }
      assert.ok(contrastRatio('#ffffff', t['--ui-action']) >= 4.5, `${label} white on the primary action`);
      for (const surface of ['--ui-panel', '--ui-well', '--ui-selection-tint']) assert.ok(contrastRatio(t['--ui-accent'], t[surface]) >= 4.5, `${label} accent text on ${surface}`);
    }
  }
});

test('every rule in skins.css is opt-in, so the default look is unchanged', () => {
  // The generated base block holds the retired files' looks at zero specificity; opt-in applies to the skin rules.
  const root = postcss.parse(skinRules(read('skins.css')));
  const loose = [];
  root.walkRules(rule => {
    if (rule.parent?.type === 'atrule' && /keyframes/.test(rule.parent.name)) return;
    for (const selector of rule.selectors) if (!selector.startsWith(':root[data-skin="linear"]')) loose.push(selector);
  });
  assert.deepEqual(loose, []);
  assert.ok(root.toString().includes('@media (prefers-reduced-motion: reduce)'), 'Linear motion respects reduced motion');
});

test('the Linear look is the only look: fixed before first paint, no look or glass switches, and shipped', () => {
  const html = read('index.html');
  assert.match(html, /<html lang="en" data-skin="linear">/);
  assert.doesNotMatch(html, /apex-skin|id="skinToggle"|id="glassToggle"|glass\.js/);
  assert.match(html, /<script src="skin\.js"><\/script>/);
  assert.match(read('scripts/sync-static.mjs'), /"skin\.js"/);
  assert.doesNotMatch(read('scripts/sync-static.mjs'), /"glass\.js"/);
  assert.match(read('lib/ui-style-build.mjs'), /\['skins\.css','skin'\]/);
});

test('start-up announces the Linear look once and forgets choices saved by earlier versions', () => {
  const removed = [], listeners = {}, events = [];
  const document = {documentElement: {dataset: {}}};
  const context = {
    document, localStorage: {removeItem: k => removed.push(k)}, requestAnimationFrame: () => {},
    addEventListener: (type, fn) => { listeners[type] = fn; }, dispatchEvent: e => events.push(e.detail), CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
  };
  context.window = context;
  vm.runInNewContext(read('skin.js'), context);
  listeners.DOMContentLoaded();
  assert.equal(document.documentElement.dataset.skin, 'linear');
  assert.deepEqual(removed, ['apex-skin']);
  assert.deepEqual(events, ['linear']);
});

test('the compact density mode is gone', () => {
  for (const file of ['skins.css', 'live-linear.css', 'linear-workspace.js']) assert.doesNotMatch(read(file), /data-linear-density|densityToggle|toggleDensity/, file);
});
