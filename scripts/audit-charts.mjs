#!/usr/bin/env node
// Chart audit: renders every route that draws charts and measures each SVG at its rendered pixel size (text size, weight
// and colour; stroke widths; point radii), then reports what departs from the chart rules in docs/linear-components.md
// ("Chart (SVG)"): axis text 11 px 450, labels 500 11 px, grid 1 px, data lines 1.75 px (context 1 px), points 3.5 px.
//   node scripts/audit-charts.mjs [--widths 1440,390] [--themes dark] [--only regex] [--verbose]
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as playwright from 'playwright';
import {qaStates} from './qa-states.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const widths = arg('--widths', '1440,390').split(',').map(Number);
const themes = arg('--themes', 'dark').split(',');
const only = arg('--only', null) && new RegExp(arg('--only'));
const verbose = process.argv.includes('--verbose');
const port = 54240 + Math.floor(Math.random() * 40);
const origin = `http://127.0.0.1:${port}`;

export const CHART_SPEC = {
  textSizes: [10, 11, 12, 13],       // 11 axis/labels; 10 dense ticks; 12–13 only for in-chart titles and value readouts
  textWeights: [450, 500, 600],
  strokes: [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3], // hairlines and context 1, data 1.75, emphasis 2–3 (selected, reference)
  radii: [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6], // dense 2, points 3.5, hover/selected up to 5–6
};

const MEASURE = spec => {
  const findings = [], seen = {text: {}, stroke: {}, radius: {}};
  const near = (v, list, tol) => list.some(x => Math.abs(x - v) <= tol);
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity !== 0; };
  const where = el => { const svg = el.ownerSVGElement || el; const host = svg.closest('[id], .performance-chart-card, .season-card, section'); return (host?.id ? '#' + host.id : host?.className?.toString().split(' ')[0] || 'svg') + ' ' + (svg.getAttribute('class') || '').split(' ')[0]; };
  const add = (kind, value, el) => findings.push({kind, value, where: where(el), sample: (el.textContent || el.tagName).trim().slice(0, 24)});
  const tally = (bucket, key) => { seen[bucket][key] = (seen[bucket][key] || 0) + 1; };
  for (const svg of document.querySelectorAll('svg')) {
    const box = svg.getBoundingClientRect();
    if (box.width < 60 || box.height < 30 || !vis(svg) || svg.closest('button, .sort-icon, .team-logo, .season-avatar, header, nav, #linearWorkspace')) continue;
    for (const el of svg.querySelectorAll('text')) {
      if (!vis(el) || !el.textContent.trim()) continue;
      const s = getComputedStyle(el), scale = el.getScreenCTM()?.a || 1;
      const px = Math.round(parseFloat(s.fontSize) * scale * 4) / 4, w = parseInt(s.fontWeight, 10);
      tally('text', `${px}px ${w}`);
      if (!near(px, spec.textSizes, .3)) add('text-size', px + 'px', el);
      if (!spec.textWeights.includes(w)) add('text-weight', w, el);
    }
    for (const el of svg.querySelectorAll('line, path, polyline, polygon, rect, circle')) {
      if (!vis(el)) continue;
      const s = getComputedStyle(el), scale = s.vectorEffect === 'non-scaling-stroke' ? 1 : (el.getScreenCTM()?.a || 1);
      if (s.stroke !== 'none' && parseFloat(s.strokeWidth) > 0 && +s.strokeOpacity > 0 && !(el.tagName === 'rect' && s.fill !== 'none' && parseFloat(s.strokeWidth) * scale <= .5)) {
        const sw = Math.round(parseFloat(s.strokeWidth) * scale * 100) / 100;
        tally('stroke', `${el.tagName} ${sw}`);
        if (!near(sw, spec.strokes, .12)) add('stroke', `${el.tagName} ${sw}px`, el);
      }
      if (el.tagName === 'circle' && s.fill !== 'none' && +s.fillOpacity > 0) {
        const r = Math.round(parseFloat(s.r || el.getAttribute('r')) * (el.getScreenCTM()?.a || 1) * 100) / 100;  // computed r: CSS may resize the point
        tally('radius', String(r));
        if (r > 0 && !near(r, spec.radii, .15)) add('radius', r + 'px', el);
      }
    }
  }
  // Tooltips and value cards: one surface (toast, spec §11).
  const tips = [...document.querySelectorAll('[role="tooltip"], .chart-tooltip, .season-tip, .perf-value-card, .value-card, .tooltip')].filter(vis);
  for (const t of tips) { const s = getComputedStyle(t); tally('text', `tip r${s.borderTopLeftRadius} ${s.backgroundColor}`); }
  return {findings, seen};
};

const STATES = qaStates(origin);

const server = spawn(process.execPath, ['scripts/serve-static.mjs', String(port)], {cwd: root, stdio: 'ignore'});
await new Promise(r => setTimeout(r, 1500));
// --browser chromium|firefox|webkit: run the same audit in another engine (cross-browser check).
const engine = process.argv.includes('--browser') ? process.argv[process.argv.indexOf('--browser') + 1] : 'chromium';
const browser = await playwright[engine].launch();
const groups = new Map(), totals = {text: {}, stroke: {}, radius: {}};
let runs = 0;
try {
  for (const theme of themes) for (const width of widths) for (const [state, setup] of Object.entries(STATES)) {
    if (only && !only.test(state)) continue;
    const page = await browser.newPage({viewport: {width, height: 1000}});
    await page.addInitScript(t => localStorage.setItem('apex-theme', t), theme);
    try {
      await setup(page);
      await page.evaluate(() => document.fonts.ready);
      // Charts below the fold still render; open folded sections so their charts are measured too.
      await page.locator('details').evaluateAll(nodes => nodes.forEach(node => { node.open = true; }));
      await page.waitForTimeout(400);
      const {findings, seen} = await page.evaluate(MEASURE, CHART_SPEC);
      runs++;
      for (const b of Object.keys(totals)) for (const [k, n] of Object.entries(seen[b])) totals[b][k] = (totals[b][k] || 0) + n;
      for (const f of findings) {
        const key = `${f.kind} ${f.value} @ ${f.where}`;
        const g = groups.get(key) || {count: 0, states: new Set(), sample: f.sample};
        g.count++; g.states.add(state); groups.set(key, g);
      }
    } catch (e) { console.log(`! ${state} ${theme} ${width}: ${e.message.split('\n')[0]}`); }
    await page.close();
  }
} finally { await browser.close(); server.kill(); }
if (verbose) for (const b of Object.keys(totals)) console.log(b, JSON.stringify(Object.entries(totals[b]).sort((x, y) => y[1] - x[1]).slice(0, 30)));
console.log(`${runs} renders · ${groups.size} distinct chart findings`);
for (const [key, g] of [...groups].sort((a, b) => b[1].count - a[1].count))
  console.log(String(g.count).padStart(5), ' ', key.padEnd(70), `«${g.sample}»`, `[${[...g.states].join(',')}]`);
process.exitCode = groups.size ? 1 : 0;
