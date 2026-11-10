#!/usr/bin/env node
// Which appearance declarations in the superseded stylesheets still matter? For every page state of the Linear audit, in both
// themes and at desktop, tablet and phone width, this strips the appearance declarations (colour, background, border, shadow,
// type) of the chosen files from the live page and compares every element's computed style (and its ::before/::after) before
// and after. A declaration that changes nothing anywhere is overridden by skins.css and can go; one that changes something is
// listed as needed, with the element it affects.
//   node scripts/legacy-overrides.mjs [--files a.css,b.css] [--out test-results/legacy-overrides.json]
// scripts/prune-legacy.mjs then deletes the overridden declarations from the source files.
import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {isolate, replayFixture} from '../e2e/helpers.mjs';
import {UI_STYLES} from '../lib/ui-style-build.mjs';
import {UNOBSERVED} from './prune-legacy-rules.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
export const LEGACY = ['design-system.css', 'polish.css', 'apple-ui.css', 'workspace-ui.css', 'macos-ui.css', 'ui-controls.css', 'macos-window.css', 'hig-system.css'];
const files = arg('--files', LEGACY.join(',')).split(',');
const outFile = arg('--out', path.join(root, 'test-results/legacy-overrides.json'));
const port = 54240 + Math.floor(Math.random() * 40), origin = `http://127.0.0.1:${port}`;

const session = async page => {
  await isolate(page); await replayFixture(page, 'session-view.json.gz');
  await page.goto(origin + '/apex?year=2026'); await page.waitForSelector('#gp option', {state: 'attached'});
  await page.evaluate(() => { const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change', {bubbles: true})); }; set('gp', '16'); set('session', 'Qualifying'); });
  await page.evaluate(() => document.getElementById('loadSession').click());
  await page.waitForFunction(() => document.querySelectorAll('#driverPills button').length > 4, null, {timeout: 60000});
  await page.evaluate(() => { const p = document.querySelectorAll('#driverPills button'); p[0].click(); p[4].click(); });
  await page.waitForTimeout(500);
  await page.evaluate(() => { toggleLoadedLap('VER', 11); toggleLoadedLap('LEC', 11); });
  await page.waitForTimeout(2500);
};
const STATES = {
  'session-empty': async page => { await isolate(page); await replayFixture(page, 'session-view.json.gz'); await page.goto(origin + '/apex?year=2026'); await page.waitForSelector('#gp option', {state: 'attached'}); await page.waitForTimeout(800); },
  'session-loaded': session,
  'session-lap-sheet': async page => { await session(page); await page.evaluate(() => document.getElementById('lapWorkspaceToggle').click()); await page.waitForTimeout(800); },
  'session-compute': async page => { await session(page); await page.evaluate(() => document.getElementById('computeSettings')?.showPopover?.()); await page.waitForTimeout(400); },
  'session-explanations': async page => { await session(page); await page.evaluate(() => document.getElementById('explanationsToggle')?.click()); await page.waitForTimeout(600); },
  'session-menu': async page => { await session(page); await page.locator('.app-sidebar .select-trigger').first().click(); await page.waitForTimeout(400); },
};
for (const m of ['pace', 'corners', 'straight', 'braking', 'pits', 'tyres', 'trend', 'results'])
  STATES['cars-' + m] = async page => { await isolate(page); await replayFixture(page); await page.goto(`${origin}/apex/cars/${m}?year=2026&scope=tracks&races=16,17,18&run=1`); await page.locator('#performanceMetricPanel:not([aria-busy="true"])').waitFor({timeout: 30000}); await page.waitForTimeout(1200); };
STATES['cars-empty'] = async page => { await isolate(page); await replayFixture(page); await page.goto(`${origin}/apex/cars?year=2026`); await page.waitForTimeout(2500); };
for (const t of ['schedule', 'results', 'standings', 'drivers', 'h2h', 'upgrades', 'units'])
  STATES['season-' + t] = async page => { await page.goto(`${origin}/apex/season/${t}?year=2026`); await page.locator('#seasonHub .season-body > :not(.season-loading)').first().waitFor({timeout: 30000}); await page.waitForTimeout(900); };
STATES['live'] = async page => { await page.goto(origin + '/apex/live'); await page.waitForTimeout(2000); };
STATES['ui-catalog'] = async page => { await page.goto(origin + '/apex/ui-catalog.html'); await page.waitForTimeout(1500); };

// Runs in the page. Returns the needed (file, selector, property) triples, every selector seen, and unexplained differences.
const PROBE = ({order, targets, unobserved, keep}) => {
  const PROPS = ['background-color', 'background-image', 'color', 'box-shadow', 'text-shadow', 'font-size', 'font-weight', 'font-family', 'font-style',
    'line-height', 'letter-spacing', 'text-transform', 'backdrop-filter', 'filter', 'opacity', 'font-variant-numeric', 'font-variant-caps', 'font-variant-ligatures', 'font-feature-settings', 'font-stretch', 'font-variation-settings', 'font-optical-sizing', 'font-kerning',
    ...['top', 'right', 'bottom', 'left'].flatMap(s => [`border-${s}-color`, `border-${s}-width`, `border-${s}-style`]),
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius'];
  const appearance = /^(?:background(?:-.+)?|color|border(?:-.+)?|box-shadow|text-shadow|font(?:-.+)?|letter-spacing|line-height|text-transform|backdrop-filter|filter)$/;
  const norm = s => s.replace(/\s+/g, '').replace(/["']/g, '').replace(/(^|[^:]):(before|after|placeholder|marker|selection)\b/g, '$1::$2');
  const sheet = [...document.styleSheets].find(s => /\/styles\.css(\?|$)/.test(s.href || ''));
  if (!sheet) return {error: 'styles.css not found'};
  const blocks = [...sheet.cssRules].filter(r => r instanceof CSSLayerBlockRule && r.name !== 'focus');
  // Transitions would make a computed colour lag behind the rule change: switch them off before the first reading.
  const still = document.createElement('style'); still.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }'; document.head.append(still);
  void document.body.offsetWidth;
  const els = [...document.querySelectorAll('*')];
  const snap = () => els.map(el => [null, '::before', '::after'].map(p => { const s = getComputedStyle(el, p); if (p && s.content === 'none') return ''; return PROPS.map(k => s.getPropertyValue(k)).join('|'); }));
  const before = snap();
  // Split at top-level commas and semicolons only (not inside :is(…), var(…), url(…) or quotes).
  const splitTop = (text, sep) => { const out = []; let depth = 0, quote = '', cur = '';
    for (const ch of text) {
      if (quote) { if (ch === quote) quote = ''; cur += ch; continue; }
      if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
      if (ch === '(') depth++; else if (ch === ')') depth--;
      if (ch === sep && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur); return out; };
  // Every removable declaration: (rule, file, selector, property). Declarations are removed by rewriting the rule's own text,
  // as the source edit would: a shorthand written with var() (font: 450 var(--a)/1.4 var(--b)) cannot be removed through its
  // longhands. What prune-legacy.mjs always keeps (states this check cannot open, media other than width) is left alone, so
  // the page here ends up in exactly the state the source edit produces.
  const seen = new Set(), rules = [];
  const keepRx = new RegExp(unobserved);
  const walk = (list, file, skip = false) => { for (const r of list) {
    if (r instanceof CSSMediaRule) { walk(r.cssRules, file, skip || !/(?:min|max)-(?:width|height)|orientation/.test(r.media.mediaText)); continue; }
    if (r instanceof CSSKeyframesRule || r instanceof CSSFontFaceRule) continue;
    if (r instanceof CSSStyleRule) {
      const sel = norm(r.selectorText); seen.add(`${file}\u0001${sel}`);
      if (!skip && !keepRx.test(r.selectorText)) {
        const decls = splitTop(r.style.cssText, ';').map(d => d.trim()).filter(Boolean);
        const items = decls.map(d => { const prop = d.slice(0, d.indexOf(':')).trim(); return {text: d, prop, key: appearance.test(prop) ? `${file}\u0001${sel}\u0001${prop}` : null}; });
        if (items.some(i => i.key)) rules.push({rule: r, file, sel, parts: splitTop(r.selectorText, ',').map(x => x.trim()), items});
      }
      if (r.cssRules?.length) walk(r.cssRules, file, skip || keepRx.test(r.selectorText));
    } else if (r.cssRules) walk(r.cssRules, file, skip);
  } };
  order.forEach((file, i) => { if (targets.includes(file) && blocks[i]) walk(blocks[i].cssRules, file); });
  const keepKeys = new Set(keep);
  const apply = () => { for (const r of rules) r.rule.style.cssText = r.items.filter(i => !i.key || keepKeys.has(i.key)).map(i => i.text).join('; '); };
  const base = s => s.replace(/::?(before|after|placeholder|marker|selection)\b.*$/, '').replace(/:(hover|focus|focus-visible|focus-within|active)\b/g, '') || '*';
  const matches = (el, part) => { try { return el.matches(base(part)); } catch { return false; } };
  // Does declared property p (maybe a shorthand) set computed longhand c?
  const sets = (p, c) => p === c || c.startsWith(p + '-') || (p === 'font' && (c.startsWith('font-') || c === 'line-height')) || (p === 'background' && c.startsWith('background-'))
    || (p.startsWith('border') && c.startsWith('border') && (p === 'border' ? !c.endsWith('-radius') : p.split('-').slice(1).every(t => c.split('-').includes(t))));
  // Fixed point: remove the candidates, compare every element with the original, put back each declaration that sets a
  // changed property on an element it applies to, and repeat until nothing differs (or nothing more can be put back).
  const needed = new Set(); let residual = [], rounds = 0;
  for (; rounds < 25; rounds++) {
    apply();
    const after = snap(); let restored = 0; residual = [];
    els.forEach((el, i) => [0, 1, 2].forEach(k => {
      if (before[i][k] === after[i][k]) return;
      const a = before[i][k].split('|'), b = after[i][k].split('|');
      const changed = PROPS.filter((_, j) => a[j] !== b[j]);
      let hit = false;
      for (const r of rules) {
        const own = r.parts.some(part => { const pseudo = /::?(before|after)\b/.exec(part)?.[1]; return (k === 0 ? !pseudo : pseudo === (k === 1 ? 'before' : 'after')) && matches(el, part); });
        if (!own) continue;
        for (const it of r.items) if (it.key && !keepKeys.has(it.key) && changed.some(c => sets(it.prop, c))) { keepKeys.add(it.key); needed.add(it.key); restored++; hit = true; }
      }
      if (!hit) residual.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.classList[0] ? '.' + el.classList[0] : ''}${k ? ['', '::before', '::after'][k] : ''}: ${changed.join(',')}`);
    }));
    if (!restored) break;
  }
  // Whatever still differs after the last round is not explained by a single declaration: report it (the driver then keeps
  // every declaration of the rules that apply to those elements).
  return {needed: [...needed], seen: [...seen], unexplained: residual.slice(0, 40), residual: residual.length, rounds, removable: rules.reduce((n, r) => n + r.items.filter(i => i.key).length, 0)};
};

const server = spawn(process.execPath, ['scripts/serve-static.mjs', String(port)], {cwd: root, stdio: 'ignore'});
await new Promise(r => setTimeout(r, 1500));
const browser = await chromium.launch();
const needed = new Set(), seen = new Set(), unexplained = new Map();
const order = UI_STYLES.map(([f]) => f);
// Sweeps over every state until none needs a declaration put back: a declaration one state needs is kept for all, and the
// next sweep checks every state again with that smaller removal set.
try {
  for (let sweep = 1; sweep <= 6; sweep++) {
    const before = needed.size; unexplained.clear();
    for (const [theme, width] of [['dark', 1440], ['dark', 1024], ['dark', 390], ['light', 1440], ['light', 390]]) for (const [state, setup] of Object.entries(STATES)) {
      const page = await browser.newPage({viewport: {width, height: 1000}});
      await page.addInitScript(t => localStorage.setItem('apex-theme', t), theme);
      try {
        await setup(page);
        const r = await page.evaluate(PROBE, {order, targets: files, unobserved: UNOBSERVED.source, keep: [...needed]});
        if (r.error) throw new Error(r.error);
        r.needed.forEach(k => needed.add(k)); r.seen.forEach(k => seen.add(k));
        for (const u of r.unexplained) unexplained.set(u, (unexplained.get(u) || new Set()).add(`${state} ${theme} ${width}`));
        console.log(`sweep ${sweep}`, state, theme, width, 'put back', r.needed.length, 'rounds', r.rounds, 'residual', r.residual);
      } catch (e) { console.error('ERR', state, theme, width, e.message.slice(0, 120)); }
      await page.close();
    }
    console.log(`sweep ${sweep}: ${needed.size - before} declarations put back`);
    if (needed.size === before) break;
  }
} finally { await browser.close(); server.kill(); }
const split = k => { const [file, sel, prop] = k.split('\u0001'); return {file, sel, prop}; };
await writeFile(outFile, JSON.stringify({generated: new Date().toISOString(), files, needed: [...needed].map(split), seen: [...seen].map(k => { const [file, sel] = k.split('\u0001'); return {file, sel}; }),
  unexplained: [...unexplained].map(([u, s]) => ({diff: u, where: [...s].slice(0, 4)}))}, null, 1));
console.log(`needed ${needed.size} declarations · ${seen.size} selectors seen · ${unexplained.size} unexplained differences → ${path.relative(root, outFile)}`);
