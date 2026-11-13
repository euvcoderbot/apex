#!/usr/bin/env node
// Linear design audit: renders every route and state, checks every visible element against docs/linear-design-spec.md, and
// groups the findings by component. Writes JSON (for tests and docs) and prints a summary.
//   node scripts/audit-linear.mjs [--out file.json] [--widths 1440,1024,390] [--themes dark,light] [--quick]
import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {isolate, replayFixture} from '../e2e/helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const quick = process.argv.includes('--quick');
const widths = arg('--widths', quick ? '1440' : '1440,1024,390').split(',').map(Number);
const themes = arg('--themes', quick ? 'dark' : 'dark,light').split(',');
const outFile = arg('--out', path.join(root, 'test-results/linear-audit.json'));
// --only <regex>: audit only matching states; --shots <dir>: also save a full-page screenshot of each render (visual review).
const only = arg('--only', null) && new RegExp(arg('--only'));
const shots = arg('--shots', null);
const scrollShots = process.argv.includes('--scroll-shots');
const expandDetails = process.argv.includes('--expand-details');
const port = 54190 + Math.floor(Math.random() * 50);
const origin = `http://127.0.0.1:${port}`;

// The spec's scales (docs/linear-design-spec.md §2, §4, §8).
export const SPEC = {
  sizes: [10, 11, 12, 13, 14, 15, 16, 18, 20, 24, 32, 36],
  weights: [450, 500, 600],
  radii: [0, 2, 4, 5, 6, 8, 10, 12, 21],  // controls 8, cards 10, panel/toast 12, dialog 21 [A]; 2–6 for marks and heat cells
  controlHeights: [18, 20, 22, 24, 26, 28, 32, 36, 44],
};

const AUDIT = spec => {
  const tokens = getComputedStyle(document.documentElement);
  const tok = name => tokens.getPropertyValue(name).trim();
  const toRgb = c => { const d = document.createElement('i'); d.style.color = c; document.body.append(d); const v = getComputedStyle(d).color; d.remove(); return v; };
  const allowedText = new Set(['--ui-label', '--ui-secondary', '--ui-tertiary', '--ui-quaternary', '--ui-accent', '--ui-positive', '--ui-negative',
    '--ui-warning', '--ui-action', '--ui-tile-on-label', '--ui-list-selected-label', '--lin-nav-text', '--lin-prop-label'].map(t => tok(t)).filter(Boolean).map(toRgb).concat(['rgb(255, 255, 255)', 'rgba(0, 0, 0, 0)']));
  const name = el => { const parts = []; for (let n = el, i = 0; n && n !== document.body && i < 2; n = n.parentElement, i++) { const c = [...n.classList].filter(c => !/^(is-|has-)/.test(c))[0]; parts.unshift(n.id ? `#${n.id}` : c ? `.${c}` : n.tagName.toLowerCase()); } return parts.join(' > '); };
  const where = el => (el.closest('[id]')?.id || '');
  const findings = [];
  const add = (el, rule, value) => findings.push({component: name(el), rule, value: String(value), scope: where(el), text: (el.textContent || '').trim().slice(0, 24)});
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('svg, canvas, script, style, template, [hidden], .visually-hidden, .sr-only')) continue;
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    const s = getComputedStyle(el); if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity === 0) continue;
    const ownText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    const teamScoped = el.closest('[style*="--team"], .team-mark, .season-avatar, [data-tone]');
    if (ownText) {
      const size = Math.round(parseFloat(s.fontSize) * 2) / 2, weight = parseInt(s.fontWeight);
      if (!spec.sizes.includes(size) && !el.closest('.sector-delta-slot, .team-mark')) add(el, 'font-size', size + 'px');
      if (!spec.weights.includes(weight)) add(el, 'font-weight', weight);
      if (s.textTransform === 'uppercase') add(el, 'uppercase', 'text-transform');
      if (!allowedText.has(s.color) && !teamScoped && !el.closest('a, .summary-delta, .sector-cell, .compound-badge, [class*="tyre"], [class*="compound"], .is-gain, .is-loss, .is-faster, .is-slower, .is-up, .is-down')) add(el, 'text-colour', s.color);
    }
    if (/gradient/.test(s.backgroundImage) && !teamScoped && !el.closest('.season-track, .season-hero, .season-h2h-hero, .season-next-circuit, [class*="map"], [class*="tyre"], [class*="compound"]')) add(el, 'gradient', s.backgroundImage.slice(0, 40));
    if (s.boxShadow !== 'none') {
      const blurs = [...s.boxShadow.matchAll(/(-?[\d.]+)px (-?[\d.]+)px ([\d.]+)px/g)].map(m => +m[3]);
      const floating = el.matches('[popover], dialog, .select-menu, .app-toast, .tooltip, [role="menu"], [role="listbox"], .lap-selection-body, #computeSettings, .trace-settings') || s.position === 'fixed';
      // The spec's faint shadow (0 .5px 1px 1px) is part of panels and cards; anything softer is a glow.
      if (blurs.some(b => b > 1) && !floating) add(el, 'shadow', s.boxShadow.slice(0, 50));
    }
    const boxed = s.backgroundColor !== 'rgba(0, 0, 0, 0)' || s.boxShadow !== 'none' || (s.borderStyle !== 'none' && parseFloat(s.borderWidth) > 0);
    if (boxed) {
      const rad = s.borderTopLeftRadius, px = parseFloat(rad);
      const round = rad.includes('%') || px >= Math.min(r.width, r.height) / 2 - 1;
      if (!round && !spec.radii.includes(Math.round(px))) add(el, 'radius', rad);
    }
    if (el.matches('button, [role="button"], select, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), .select-trigger') && !el.closest('#linearWorkspace .driver-pill, .lap, .corner-pick, .season-strip-cell, .season-battle')) {
      const h = Math.round(r.height);
      // A sortable column title that wraps onto more lines is text sized by its words, not a fixed-height control.
      const wrappedTitle = el.closest('th') && h > 28 && el.getClientRects().length && parseFloat(s.lineHeight) && h >= 2 * parseFloat(s.lineHeight);
      if (!spec.controlHeights.includes(h) && h < 60 && !wrappedTitle) add(el, 'control-height', h + 'px');
    }
  }
  // Component families: every distinct look of a card, button, heading, table header and chip on the page, so competing
  // implementations of one component show up even when each value is individually on the scale.
  const families = [];
  const sig = (el, kind, parts) => families.push({kind, sig: parts.join(' | '), component: name(el), text: (el.textContent || '').trim().slice(0, 20)});
  const ring = s => (s.boxShadow === 'none' ? '' : s.boxShadow.replace(/rgba?\(([^)]*)\)/g, (m, v) => `rgba(${v.replace(/\s/g, '')})`).slice(0, 70)) + (s.borderStyle !== 'none' && parseFloat(s.borderWidth) ? ` border ${s.borderWidth} ${s.borderColor}` : '');
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('svg, canvas, [hidden]')) continue;
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden') continue;
    const boxed = s.backgroundColor !== 'rgba(0, 0, 0, 0)' || s.boxShadow !== 'none' || (s.borderStyle !== 'none' && parseFloat(s.borderWidth) > 0);
    if (boxed && r.width >= 220 && r.height >= 64 && parseFloat(s.borderTopLeftRadius) >= 6 && !el.matches('button, [popover], dialog') && s.position !== 'fixed')
      sig(el, 'card', [`bg ${s.backgroundColor}`, `ring ${ring(s)}`, `r ${s.borderTopLeftRadius}`]);
    // Buttons that are not buttons in the design: list rows (teammate battles), table headers (sort), rail section headings
    // and lap tiles are their own kinds, so the button count reflects controls only.
    const role = el.matches('.season-battle, .lap-grid > .lap') ? 'row' : el.matches('.perf-sort-btn, th button') ? 'table-sort' : el.matches('.linear-nav-heading') ? 'section-label' : 'button';
    if (role !== 'button' && el.matches('button') && r.height < 60) sig(el, role, [`h ${Math.round(r.height)}`, `font ${s.fontWeight} ${s.fontSize}`]);
    else if (el.matches('button, a[role="button"], .select-trigger') && r.height < 60) {
      sig(el, 'button', [`h ${Math.round(r.height)}`, `r ${parseFloat(s.borderTopLeftRadius) >= r.height / 2 - 1 ? 'pill' : s.borderTopLeftRadius}`, `bg ${s.backgroundColor}`, `ring ${ring(s)}`, `font ${s.fontWeight} ${s.fontSize}`]);
      // The same without fill and ring: selected, hover and disabled states of one role are not separate looks.
      sig(el, 'button-role', [`h ${Math.round(r.height)}`, `r ${parseFloat(s.borderTopLeftRadius) >= r.height / 2 - 1 ? 'pill' : s.borderTopLeftRadius}`, `font ${s.fontWeight} ${s.fontSize}`]);
    }
    if (el.matches('h1, h2, h3, h4, .perf-chart-heading, .chart-heading h2'))
      sig(el, 'heading', [`${el.tagName.toLowerCase()}`, `font ${s.fontWeight} ${s.fontSize}`, `color ${s.color}`]);
    if (el.matches('th'))
      sig(el, 'table-header', [`font ${s.fontWeight} ${s.fontSize}`, `color ${s.color}`, `h ${Math.round(r.height)}`, `bg ${s.backgroundColor}`]);
  }
  return {findings, families};
};

// Layout fidelity (docs/linear-design-spec.md §3, §5–§7): frame geometry, alignment, rhythm, density, hierarchy, nesting.
const LAYOUT = () => {
  const box = el => el && el.getBoundingClientRect();
  const vis = el => { if (!el) return false; const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 2 && r.height > 2 && s.display !== 'none' && s.visibility !== 'hidden'; };
  const rail = document.querySelector('#linearWorkspace'), header = document.querySelector('.site-header');
  const view = document.querySelector('#seasonHub:not([hidden])') || document.querySelector('#carPerformance:not([hidden])') || document.querySelector('main#top');
  const railRows = rail ? [...rail.querySelectorAll('button, a')].filter(vis).map(e => Math.round(box(e).height)) : [];
  const count = a => a.reduce((m, v) => (m[v] = (m[v] || 0) + 1, m), {});
  // Content blocks: the cards and headings that compose the page, in reading order.
  const blockSel = '.season-card, .season-round, .performance-chart-card, .performance-table-wrap, .dashboard-card, #charts .chart, .lap-summary-card, .overview-tile, .overview-chart, .time-summary-card, .corner-analysis, .dominance-map, .season-h2h-hero, .season-numbers, .season-tiles, .season-next-body';
  const blocks = view ? [...view.querySelectorAll(blockSel)].filter(vis) : [];
  const lefts = count(blocks.map(b => Math.round(box(b).left)));
  // Vertical gaps between a block and the next block that starts below it in the same column.
  const gaps = [];
  for (const b of blocks) { const r = box(b); const below = blocks.map(box).filter(o => Math.abs(o.left - r.left) < 2 && o.top >= r.bottom - 1).sort((x, y) => x.top - y.top)[0]; if (below) gaps.push(Math.round(below.top - r.bottom)); }
  // Nested cards as the eye sees them: a drawn box (fill, border or ring) inside another drawn box. A section that only
  // groups cards (no fill, no outline) does not count.
  const drawn = el => { const s = getComputedStyle(el); return s.backgroundColor !== 'rgba(0, 0, 0, 0)' || s.boxShadow.includes('inset') || (s.borderStyle !== 'none' && parseFloat(s.borderWidth) > 0); };
  const nested = blocks.filter(drawn).filter(b => { for (let a = b.parentElement?.closest(blockSel); a; a = a.parentElement?.closest(blockSel)) if (drawn(a)) return true; return false; }).length;
  const rows = [...document.querySelectorAll('tbody tr, .season-round-rows > div, .time-summary-lists li, .season-history li, .season-forecast-row, #driverPills .driver-pill')].filter(vis).map(r => Math.round(box(r).height));
  const headings = [...(view || document).querySelectorAll('h1, h2, h3, h4')].filter(vis).map(h => `${h.tagName}:${parseFloat(getComputedStyle(h).fontSize)}`);
  const vb = view && box(view), hb = header && box(header);
  return {
    railWidth: rail && Math.round(box(rail).width), railRowHeights: count(railRows),
    headerHeight: hb && Math.round(hb.height), viewLeft: vb && Math.round(vb.left), viewWidth: vb && Math.round(vb.width),
    contentLeftEdges: lefts, distinctLeftEdges: Object.keys(lefts).length, blockGaps: count(gaps), nestedCards: nested,
    rowHeights: count(rows), headingSequence: headings.slice(0, 14).join(' '),
  };
};

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
};
for (const m of ['pace', 'corners', 'straight', 'braking', 'pits', 'tyres', 'trend', 'results'])
  STATES['cars-' + m] = async page => { await isolate(page); await replayFixture(page); await page.goto(`${origin}/apex/cars/${m}?year=2026&scope=tracks&races=16,17,18&run=1`); await page.locator('#performanceMetricPanel:not([aria-busy="true"])').waitFor({timeout: 30000}); await page.waitForTimeout(1200); };
STATES['cars-empty'] = async page => { await isolate(page); await replayFixture(page); await page.goto(`${origin}/apex/cars?year=2026`); await page.waitForTimeout(2500); };
for (const t of ['schedule', 'results', 'standings', 'drivers', 'h2h', 'upgrades', 'units'])
  STATES['season-' + t] = async page => {
    await page.goto(`${origin}/apex/season/${t}?year=2026`);
    await page.locator('#seasonHub .season-body > :not(.season-loading)').first().waitFor({timeout: 30000});
    if (/Could not load|Failed to fetch/i.test(await page.locator('#seasonHub .season-body').innerText())) throw new Error('Season data did not load; check static QA assets.');
    await page.waitForTimeout(900);
  };
for (const label of ['Teams', 'PU manufacturers']) {
  STATES['season-units-' + label.toLowerCase().replaceAll(' ', '-')] = async page => {
    await STATES['season-units'](page);
    await page.getByRole('group', {name: 'Group by', exact: true}).getByRole('button', {name: label, exact: true}).click();
  };
}
STATES['ui-catalog'] = async page => { await page.goto(origin + '/apex/ui-catalog.html'); await page.waitForTimeout(1500); };

const server = spawn(process.execPath, ['scripts/serve-static.mjs', String(port)], {cwd: root, stdio: 'ignore'});
await new Promise(r => setTimeout(r, 1500));
const browser = await chromium.launch();
const groups = new Map(), familyMap = new Map(), layouts = {};
let runs = 0;
const errors = [];
try {
  for (const theme of themes) for (const width of widths) for (const [state, setup] of Object.entries(STATES)) {
    if ((quick && state === 'ui-catalog') || (only && !only.test(state))) continue;
    const page = await browser.newPage({viewport: {width, height: 1000}});
    await page.addInitScript(t => localStorage.setItem('apex-theme', t), theme);
    try {
      await setup(page);
      await page.waitForFunction(() => [...document.querySelectorAll('link[rel="stylesheet"]')].every(link => link.sheet));
      await page.evaluate(() => document.fonts.ready);
      if (expandDetails) {
        await page.locator('details').evaluateAll(nodes => nodes.forEach(node => { node.open = true; }));
        await page.waitForTimeout(200);
      }
      const result = await page.evaluate(AUDIT, SPEC);
      if (shots) await page.screenshot({path: path.join(shots, `${state}-${theme}-${width}.png`), fullPage: false});  // the frame is fixed: a full-page capture shows the canvas below the fold, not the content
      if (shots && scrollShots) {
        const scroller = await page.evaluateHandle(() => document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight + 100 ? document.scrollingElement : [...document.querySelectorAll('body *')].filter(el => {
          const s = getComputedStyle(el), r = el.getBoundingClientRect();
          return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 100 && r.width > 250 && r.height > 200;
        }).sort((a, b) => b.clientWidth - a.clientWidth)[0] || document.scrollingElement);
        if (await scroller.evaluate(el => el !== document.scrollingElement)) await scroller.asElement().scrollIntoViewIfNeeded();
        const pages = await scroller.evaluate(el => Math.ceil(el.scrollHeight / Math.max(1, el.clientHeight)));
        for (let i = 1; i < pages; i++) {
          await scroller.evaluate((el, n) => {
            const top = n * el.clientHeight;
            if (el === document.scrollingElement) window.scrollTo({top, behavior: 'instant'});
            else el.scrollTo({top, behavior: 'instant'});
          }, i);
          await page.waitForTimeout(100);
          await page.screenshot({path: path.join(shots, `${state}-${theme}-${width}-scroll-${i}.png`)});
        }
        for (const [i, table] of (await page.locator('.season-table-wrap, .performance-table-wrap').all()).entries()) {
          if (!await table.isVisible() || !await table.evaluate(el => el.scrollWidth > el.clientWidth + 1)) continue;
          await table.scrollIntoViewIfNeeded();
          await table.evaluate(el => { el.scrollLeft = el.scrollWidth; });
          await page.screenshot({path: path.join(shots, `${state}-${theme}-${width}-table-${i}-right.png`)});
        }
        await scroller.dispose();
      }
      if (width >= 1200 && theme === themes[0]) layouts[state] = await page.evaluate(LAYOUT);
      for (const f of result.families) {
        const key = `${f.kind}|${f.sig}`;
        const g = familyMap.get(key) || {...f, count: 0, states: new Set()}; g.count++; g.states.add(state); familyMap.set(key, g);
      }
      for (const f of result.findings) {
        const key = `${f.rule}|${f.component}|${f.value}`;
        const g = groups.get(key) || {...f, count: 0, states: new Set(), views: new Set()};
        g.count++; g.states.add(state); g.views.add(`${theme} ${width}`); groups.set(key, g);
      }
      runs++;
    } catch (e) { errors.push({state, theme, width, message: e.message}); console.error('ERR', state, theme, width, e.message.slice(0, 100)); }
    await page.close();
  }
} finally { await browser.close(); server.kill(); }
const findings = [...groups.values()].map(g => ({...g, states: [...g.states], views: [...g.views]})).sort((a, b) => b.count - a.count);
const families = [...familyMap.values()].map(g => ({...g, states: [...g.states]})).sort((a, b) => a.kind.localeCompare(b.kind) || b.count - a.count);
await writeFile(outFile, JSON.stringify({runs, errors, generated: new Date().toISOString(), findings, families, layouts}, null, 1));
if (errors.length) process.exitCode = 1;
const kinds = {}; for (const f of families) kinds[f.kind] = (kinds[f.kind] || 0) + 1;
console.log('distinct looks per component family:', JSON.stringify(kinds));
const byRule = {}; for (const f of findings) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
console.log(`${runs} page renders · ${findings.length} distinct findings`, JSON.stringify(byRule));
for (const f of findings.slice(0, Number(arg('--top', 60)))) console.log(`${String(f.count).padStart(5)}  ${f.rule.padEnd(14)} ${f.value.padEnd(16)} ${f.component}  «${f.text}»  [${f.states.slice(0, 3).join(',')}${f.states.length > 3 ? '…' : ''}]`);
