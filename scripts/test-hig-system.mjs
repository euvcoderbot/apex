import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import postcss from 'postcss';

const css = readFileSync('hig-system.css', 'utf8');
const tokenCss = readFileSync('tokens.css', 'utf8');
const root = postcss.parse(css);
const rulesFor = pattern => {
  const found = [];
  root.walkRules(rule => { if (pattern.test(rule.selector)) found.push(rule); });
  return found;
};
const declared = (rules, prop) => rules.flatMap(rule => rule.nodes.filter(d => d.prop === prop).map(d => d.value));

test('every control family has one size, radius and type style in the final layer', () => {
  for (const kind of ['push', 'primary', 'popup', 'segment', 'run', 'choice', 'list-row', 'menu-item', 'stepper', 'toolbar', 'checkbox']) {
    assert.ok(rulesFor(new RegExp(`data-ui-kind="${kind}"`)).length, kind + ' must be owned by hig-system.css');
  }
  // Regular controls share one height; segments sit as a 26 px thumb in a 30 px track.
  const regular = rulesFor(/^button\[data-ui-kind="(push|primary|choice)"\]/);
  assert.ok(declared(regular, 'min-height').every(value => value === 'var(--hig-regular)'));
  assert.match(tokenCss, /--hig-regular: 30px/);
  assert.match(tokenCss, /--hig-thumb: 26px/);
  // macOS checkboxes are rounded squares; only radio buttons are circles.
  assert.deepEqual(declared(rulesFor(/^input\[data-ui-kind="checkbox"\]$/), 'border-radius'), ['4px']);
  // Q1/Q2/Q3 run segments respond to hover and use the segmented thumb when chosen.
  assert.ok(rulesFor(/data-ui-kind="run"\]\):hover/).length);
  assert.match(css, /\[data-ui-kind="run"\]\)\[aria-pressed="true"\] \{\s*background: var\(--ui-seg-thumb\)/);
});

test('type uses one ramp and section headers share one style across both views', () => {
  const ramp = new Set(['var(--type-caption)', 'var(--type-callout)', 'var(--type-body)', 'var(--type-headline)', 'var(--type-title3)', 'var(--type-title2)', 'var(--type-title1)', 'inherit', '0']); // 0: an icon-only label, kept for assistive technology
  const sectorDeficitSelector = '.sector-cards .lap-summary-card .sector-delta-slot .summary-delta';
  root.walkDecls('font-size', decl => assert.ok(ramp.has(decl.value) ||
    (decl.parent.selector === sectorDeficitSelector && decl.value === 'calc(var(--type-caption) * .85)'),
    decl.parent.selector + ' uses off-ramp ' + decl.value));
  assert.deepEqual(declared(rulesFor(/^\.sector-cards \.lap-summary-card \.sector-delta-slot \.summary-delta$/), 'font-size'), ['calc(var(--type-caption) * .85)']);
  const sections = rulesFor(/workspace-heading h2,.analysis-heading h2,.corner-analysis-header h2/);
  assert.deepEqual(declared(sections, 'font-size'), ['var(--type-title3)']);
});

test('motion is brief, never replays on re-render and honours Reduce Motion, Transparency and Contrast', () => {
  assert.match(tokenCss, /--hig-fast: 120ms/);
  assert.match(css, /:is\(\.lap-summary-card,\.driver-run-card,\.chart,\.corner-analysis,\.dominance-map\) \{ animation: none; \}/);
  for (const query of ['prefers-reduced-motion: reduce', 'prefers-reduced-transparency: reduce', 'prefers-contrast: more']) {
    assert.ok(css.includes(query), query);
  }
  // Translucent materials only on the navigation layer (toolbar, sticky table headers) and the
  // transient layer (menus, popovers, tooltips, toasts, sheets). Cards, charts and tables stay opaque.
  const blurred = new Set();
  root.walkDecls(/^(-webkit-)?backdrop-filter$/, decl => { if (decl.value !== 'none') blurred.add(decl.parent.selector); });
  assert.deepEqual([...blurred].sort(), [
    '.circuit-guide-details[popover]', '.local-compute-dialog', '.local-compute-dialog::backdrop', '.performance-table th',
    '.site-header, .site-header.window-toolbar', ':is(.select-menu,.tooltip,.app-toast,.circuit-guide-details[popover])',
  ]);
  // Every translucent fill has an opaque fallback for Reduce Transparency, Increase Contrast and no backdrop-filter.
  for (const fallback of ['@media (prefers-reduced-transparency: reduce), (prefers-contrast: more)', '@supports not (backdrop-filter: blur(1px))']) assert.ok(css.includes(fallback), fallback);
  // Neutral dark appearance: no blue cast in the base greys.
  const tokens = JSON.parse(readFileSync('e2e/__tokens__/tokens.json', 'utf8'));
  for (const theme of ['dark', 'light']) for (const name of ['canvas', 'panel', 'well', 'sidebar', 'toolbar', 'control', 'selected']) {
    const [r, g, b] = tokens[theme]['--ui-' + name].match(/#(..)(..)(..)/).slice(1).map(x => parseInt(x, 16));
    assert.ok(Math.abs(b - r) <= 2 && Math.abs(g - r) <= 2, `${theme} --ui-${name} is tinted`);
  }
});

test('segmented controls share one sliding thumb, kept across re-renders', () => {
  const system = readFileSync('ui-system.js', 'utf8'), state = readFileSync('session-state.js', 'utf8');
  assert.match(system, /function placeThumb\(group\)/);
  assert.match(system, /'--ui-thumb-x','--ui-thumb-y','--ui-thumb-w','--ui-thumb-h'/);
  assert.match(system, /attributeFilter:\[[^\]]*'aria-current'/);
  assert.match(css, /\[data-ui-thumb\]::before \{\s*content: '';/);
  assert.match(css, /\[data-ui-thumb="sliding"\]::before \{\s*transition: transform var\(--hig-medium\)/);
  assert.match(css, /\[data-ui-thumb\]::before \{ transition: none !important; \}/);
  // Patching a group keeps the thumb geometry the component layer wrote.
  assert.match(state, /prop\.startsWith\('--ui-'\)/);
});

test('a card header that repeats the page title is hidden, and the Kick Sauber mark is transparent', () => {
  const ui = readFileSync('dashboard-ui.js', 'utf8');
  assert.match(ui, /heading\.toggleAttribute\('data-redundant', redundant\)/);
  assert.match(ui, /replace\(\/\\s\*&\\s\*\/g, ' and '\)/);
  assert.match(css, /\.performance-card > \.panel-heading\[data-redundant\] \{ display: none; \}/);
  for (const file of ['session-state.js', 'performance-identity.js']) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /kick-sauber\.png/, file);
    assert.match(source, /kick-sauber-black\.webp.*kick-sauber-white\.webp/, file);
  }
  assert.match(readFileSync('macos-window.css', 'utf8'), /\[data-team-mark="kick-sauber"\]/);
});

// A minimal element tree, enough for the patcher.
class Node {
  constructor(tag, attrs = {}, children = []) {
    this.nodeType = tag === '#text' ? 3 : 1; this.tagName = tag.toUpperCase(); this.nodeValue = attrs.text ?? null;
    this.attrs = new Map(Object.entries(tag === '#text' ? {} : attrs)); this.childNodes = []; this.parentNode = null;
    children.forEach(child => this.appendChild(child));
  }
  get attributes() { return [...this.attrs].map(([name, value]) => ({name, value})); }
  get dataset() { return {motionKey: this.attrs.get('data-motion-key'), uiTooltip: this.attrs.get('data-ui-tooltip')}; }
  hasAttribute(name) { return this.attrs.has(name); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  removeAttribute(name) { this.attrs.delete(name); }
  appendChild(child) { child.parentNode = this; this.childNodes.push(child); return child; }
  replaceChild(next, old) { this.childNodes[this.childNodes.indexOf(old)] = next; next.parentNode = this; }
  get lastChild() { return this.childNodes.at(-1); }
  remove() { const list = this.parentNode.childNodes; list.splice(list.indexOf(this), 1); }
  querySelector(selector) { return selector.includes('data-ui-symbol') ? this.childNodes.find(c => c.attrs?.has('data-ui-symbol')) || null : null; }
  cloneNode() { return new Node(this.nodeType === 3 ? '#text' : this.tagName.toLowerCase(), this.nodeType === 3 ? {text: this.nodeValue} : Object.fromEntries(this.attrs), this.childNodes.map(c => c.cloneNode(true))); }
}

test('a selection change patches the run picker in place instead of rebuilding it', () => {
  const source = readFileSync('session-state.js', 'utf8');
  const box = {};
  vm.createContext(box);
  vm.runInContext(source.slice(source.indexOf('function keepsDecoratedAttribute('), source.indexOf('// Animate user-driven updates')), box);
  const logo = new Node('img', {src: 'mclaren.webp'});
  const q1 = new Node('button', {class: 'run-segment selected', 'aria-pressed': 'true', 'data-motion-key': 'run-NOR-1', 'data-ui-kind': 'run', title: 'Q1', 'data-ui-tooltip': 'auto'}, [new Node('#text', {text: 'Q1'})]);
  const q2 = new Node('button', {class: 'run-segment', 'aria-pressed': 'false', 'data-motion-key': 'run-NOR-2', 'data-ui-kind': 'run'}, [new Node('#text', {text: 'Q2'})]);
  const card = new Node('article', {'data-motion-key': 'run-card-NOR'}, [logo, q1, q2]);
  const live = new Node('div', {}, [card]);
  const next = new Node('div', {}, [new Node('article', {'data-motion-key': 'run-card-NOR'}, [
    new Node('img', {src: 'mclaren.webp'}),
    new Node('button', {class: 'run-segment', 'aria-pressed': 'false', 'data-motion-key': 'run-NOR-1'}, [new Node('#text', {text: 'Q1'})]),
    new Node('button', {class: 'run-segment selected', 'aria-pressed': 'true', 'data-motion-key': 'run-NOR-2'}, [new Node('#text', {text: 'Q2'})]),
    new Node('p', {}, [new Node('#text', {text: 'Q2 laps'})]),
  ])]);
  box.morphChildren(live, next);
  assert.equal(live.childNodes[0], card, 'card survives');
  assert.equal(card.childNodes[0], logo, 'logo image is not re-created');
  assert.equal(card.childNodes[1], q1); assert.equal(card.childNodes[2], q2);
  assert.equal(q1.getAttribute('aria-pressed'), 'false'); assert.equal(q2.getAttribute('aria-pressed'), 'true');
  assert.equal(q1.getAttribute('data-ui-kind'), 'run', 'decorator attributes are kept');
  assert.equal(q1.getAttribute('title'), 'Q1');
  assert.equal(card.childNodes.length, 4);
  // A node with a different key is replaced, not patched into another driver.
  box.morphChildren(live, new Node('div', {}, [new Node('article', {'data-motion-key': 'run-card-PIA'})]));
  assert.notEqual(live.childNodes[0], card);
});
