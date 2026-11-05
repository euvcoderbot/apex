import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import postcss from 'postcss';
import {SKINS, generate, contrastRatio} from './generate-skin.mjs';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');

test('the Linear look tokens are generated from three inputs and skins.css is current', () => {
  const out = execFileSync(process.execPath, [new URL('./generate-skin.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--check'], {encoding: 'utf8'});
  assert.match(out, /up to date/);
  for (const theme of ['dark', 'light']) assert.deepEqual(Object.keys(SKINS.linear[theme]).sort(), ['accent', 'base', 'contrast']);
});

test('generated text and action colours meet WCAG contrast on their surfaces', () => {
  for (const [theme, input] of Object.entries(SKINS.linear)) {
    for (const contrast of [input.contrast, 100]) {
      const t = generate({...input, contrast});
      for (const surface of ['--ui-canvas', '--ui-panel', '--ui-control']) {
        assert.ok(contrastRatio(t['--ui-label'], t[surface]) >= 7, `${theme}/${contrast} label on ${surface}`);
        assert.ok(contrastRatio(t['--ui-secondary'], t[surface]) >= 4.5, `${theme}/${contrast} secondary on ${surface}`);
        assert.ok(contrastRatio(t['--ui-tertiary'], t[surface]) >= 4.5, `${theme}/${contrast} tertiary on ${surface}`);
      }
      assert.ok(contrastRatio('#ffffff', t['--ui-action']) >= 4.5, `${theme}/${contrast} white on the primary action`);
      assert.ok(contrastRatio(t['--ui-accent'], t['--ui-panel']) >= 4.5, `${theme}/${contrast} accent text on panels`);
    }
  }
});

test('every rule in skins.css is opt-in, so the default look is unchanged', () => {
  const root = postcss.parse(read('skins.css'));
  const loose = [];
  root.walkRules(rule => {
    if (rule.parent?.type === 'atrule' && /keyframes/.test(rule.parent.name)) return;
    for (const selector of rule.selectors) if (!selector.startsWith(':root[data-skin="linear"]') && !selector.startsWith('#skinToggle')) loose.push(selector);
  });
  assert.deepEqual(loose, []);
  assert.ok(root.toString().includes('@media (prefers-reduced-motion: reduce)'), 'Linear motion respects reduced motion');
});

test('the look toggle is in the toolbar, applied before first paint and shipped', () => {
  const html = read('index.html');
  assert.match(html, /localStorage\.getItem\('apex-skin'\) === 'linear'/);
  assert.match(html, /<button id="skinToggle"[^>]*aria-pressed="false"/);
  assert.ok(html.indexOf('id="skinToggle"') > html.indexOf('id="glassToggle"'));
  assert.match(html, /<script src="skin\.js"><\/script>/);
  assert.match(read('scripts/sync-static.mjs'), /"skin\.js"/);
  assert.match(read('lib/ui-style-build.mjs'), /\['skins\.css','skin'\]/);
});

test('the toggle switches looks, updates its state and remembers the choice', () => {
  const store = new Map(), listeners = {}, events = [];
  const button = {attrs: {}, title: '', setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(type, fn) { listeners['button:' + type] = fn; }};
  const document = {documentElement: {dataset: {}}, getElementById: id => id === 'skinToggle' ? button : null};
  const context = {
    document, localStorage: {setItem: (k, v) => store.set(k, v)}, requestAnimationFrame: () => {},
    addEventListener: (type, fn) => { listeners[type] = fn; }, dispatchEvent: e => events.push(e.detail), CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
  };
  context.window = context;
  vm.runInNewContext(read('skin.js'), context);
  listeners.DOMContentLoaded();
  assert.equal(button.attrs['aria-pressed'], 'false');
  listeners['button:click']();
  assert.equal(document.documentElement.dataset.skin, 'linear');
  assert.equal(button.attrs['aria-pressed'], 'true');
  assert.equal(store.get('apex-skin'), 'linear');
  listeners['button:click']();
  assert.equal(document.documentElement.dataset.skin, undefined);
  assert.equal(store.get('apex-skin'), 'macos');
  assert.deepEqual(events, ['macos', 'linear', 'macos']);
});
