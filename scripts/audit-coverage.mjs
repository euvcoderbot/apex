// Coverage audit: the places the other audits do not visit. Every Season page (Home and Tracks included), toggled states,
// older seasons and the phone width, checked for page-level sideways scroll, clipped text, fills cut by a clipping parent,
// table headers aligned against their column, uneven table rows, chart labels cut off, script errors; then the
// interactions: every Season pill keeps the pills and marks itself, every in-page pill group changes the page, every
// sortable header reorders its rows, and a tooltip never takes the pointer.
//
//   node scripts/audit-coverage.mjs [--browser chromium] [--only <state>] [--shots <dir>] [--verbose]
// Exit code 1 when anything is found. Added after a QA pass (Tracks hid the Season pills, older seasons showed another
// season's circuits, tooltips swallowed clicks, rows of the results matrix were uneven) that none of the audits covered.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as playwright from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const only = arg('--only', ''), shots = arg('--shots', null), verbose = process.argv.includes('--verbose');
const port = 54420 + Math.floor(Math.random() * 40), origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [path.join(root, 'scripts/serve-static.mjs'), String(port)], {cwd: root, stdio: 'ignore'});
await new Promise(r => setTimeout(r, 1500));

const season = (tab, q = '', year = 2026) => async page => {
  await page.goto(`${origin}/apex/season/${tab}?year=${year}${q}`);
  await page.locator('#seasonHub .season-body > :not(.season-loading)').first().waitFor({timeout: 30000});
  await page.waitForTimeout(1000);
};
const click = sel => async page => { const l = page.locator(sel).first(); if (await l.count()) { await l.scrollIntoViewIfNeeded(); await l.click(); await page.waitForTimeout(700); } };
const seq = (...steps) => async page => { for (const s of steps) await s(page); };
const STATES = {
  home: season('home'), schedule: season('schedule'), tracks: season('tracks'),
  'tracks-older': season('tracks', '&track=Spanish+Grand+Prix', 2024),
  results: season('results'), 'results-open': seq(season('results'), click('#seasonHub .season-row-toggle')),
  standings: season('standings'), drivers: season('drivers'), h2h: season('h2h'),
  upgrades: season('upgrades'), units: season('units'), 'standings-2020': season('standings', '', 2020),
};

// In the page: geometric checks. Screen-reader-only text (1 px clipped boxes) and deliberate ellipsis are not defects.
function checks() {
  const vw = document.documentElement.clientWidth, found = [];
  const name = e => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
  const shown = e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const add = (kind, e, detail) => found.push({kind, el: name(e), text: (e.innerText || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40), detail});
  if (document.documentElement.scrollWidth > vw + 1) add('page-scrolls-sideways', document.documentElement, `${document.documentElement.scrollWidth} > ${vw}`);
  const scope = document.querySelector('#seasonHub') || document.body;
  for (const e of scope.querySelectorAll('*')) {
    if (!shown(e) || (e.closest('svg') && e.tagName !== 'svg')) continue;
    const s = getComputedStyle(e), r = e.getBoundingClientRect();
    const own = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (own && /(hidden|clip)/.test(s.overflowX) && s.textOverflow !== 'ellipsis' && e.scrollWidth > e.clientWidth + 1) add('clipped-text', e, `${e.scrollWidth} > ${e.clientWidth}`);
    const filled = (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent') || s.backgroundImage !== 'none';
    if (filled && r.width < vw * .9) {
      for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
        const ps = getComputedStyle(p);
        if (/(auto|scroll)/.test(ps.overflowX + ps.overflowY)) break;
        if (/(hidden|clip)/.test(ps.overflow)) {
          const pr = p.getBoundingClientRect();
          if (r.left < pr.left - 1 || r.right > pr.right + 1 || r.top < pr.top - 1 || r.bottom > pr.bottom + 1) add('clipped-fill', e, `by ${name(p)}`);
          break;
        }
      }
    }
  }
  for (const t of scope.querySelectorAll('table')) {
    if (!shown(t)) continue;
    const head = t.tHead?.rows[t.tHead.rows.length - 1], rows = [...(t.tBodies[0]?.rows || [])].filter(shown);
    if (!head || !rows.length) continue;
    const align = c => getComputedStyle(c).textAlign.replace('start', 'left').replace('end', 'right');
    [...head.cells].forEach((th, i) => {
      if (th.colSpan !== 1 || !th.innerText.trim() || !shown(th)) return;
      const cells = rows.map(r => r.cells[i]).filter(c => c && c.colSpan === 1 && c.innerText.trim());
      const set = new Set(cells.map(align));
      if (cells.length && set.size === 1 && !set.has(align(th))) add('header-misaligned', th, `header ${align(th)}, column ${[...set][0]}`);
    });
    // A row opened to show its details is meant to be taller: compare the rows of ordinary height only.
    const hs = rows.map(r => Math.round(r.getBoundingClientRect().height)), sorted = [...hs].sort((a, b) => a - b), median = sorted[sorted.length >> 1];
    const odd = hs.filter(h => h < median * 2.5 && Math.abs(h - median) > 2).length;
    if (odd && odd < hs.length / 2) add('uneven-rows', t, `${odd} of ${hs.length} rows differ from ${median} px`);
  }
  // A chart label cut off: outside its svg and hidden by a clipping parent (labels that overhang but show are fine).
  for (const svg of scope.querySelectorAll('svg')) {
    if (!shown(svg) || getComputedStyle(svg).overflow !== 'visible') {
      if (!shown(svg)) continue;
    }
    const sr = svg.getBoundingClientRect(), clipsSelf = getComputedStyle(svg).overflow !== 'visible';
    for (const tx of svg.querySelectorAll('text')) {
      const r = tx.getBoundingClientRect(); if (!r.width) continue;
      const outside = r.left < sr.left - 1 || r.right > sr.right + 1 || r.top < sr.top - 1 || r.bottom > sr.bottom + 1;
      if (!outside) continue;
      let cut = clipsSelf;
      for (let p = svg.parentElement; !cut && p && p !== document.body; p = p.parentElement) {
        const ps = getComputedStyle(p);
        if (/(hidden|clip|auto|scroll)/.test(ps.overflowX)) { const pr = p.getBoundingClientRect(); cut = r.left < pr.left - 1 || r.right > pr.right + 1; }
      }
      if (cut) add('chart-label-cut', tx, 'outside its chart and clipped');
    }
  }
  return found;
}

async function interactions(page, report) {
  // Every Season pill: opens its page, is marked, and the pills stay.
  await season('schedule')(page);
  for (const id of await page.locator('.season-tabs [data-season-tab]').evaluateAll(bs => bs.map(b => b.dataset.seasonTab))) {
    await page.locator(`.season-tabs [data-season-tab="${id}"]`).click(); await page.waitForTimeout(1000);
    if (await page.locator(`.season-tabs [data-season-tab="${id}"]`).getAttribute('aria-pressed') !== 'true') report('pill-not-marked', id);
    if (!(await page.locator('.season-tabs').isVisible())) report('pills-hidden', id);
  }
  for (const tab of ['schedule', 'tracks', 'results', 'standings', 'drivers', 'h2h', 'upgrades', 'units']) {
    await season(tab)(page);
    const groups = page.locator('#seasonHub .season-body :is([role="group"], [role="tablist"])');
    for (let g = 0, n = await groups.count(); g < n; g++) {
      const group = groups.nth(g);
      if (!(await group.isVisible())) continue;
      const options = group.locator(':scope > button, :scope > [role="tab"]'), count = await options.count();
      if (count < 2 || count > 12) continue;
      const last = options.nth(count - 1);
      if (await last.isDisabled() || await last.getAttribute('aria-pressed') === 'true' || await last.getAttribute('aria-selected') === 'true') continue;
      const before = await page.locator('#seasonHub .season-body').innerHTML();
      await last.scrollIntoViewIfNeeded(); await last.click(); await page.waitForTimeout(800);
      if (before === await page.locator('#seasonHub .season-body').innerHTML()) report('pill-group-does-nothing', `${tab} ${(await group.getAttribute('aria-label')) || g}`);
    }
    const sorts = page.locator('#seasonHub .season-body th button');
    for (let i = 0, n = Math.min(await sorts.count(), 6); i < n; i++) {
      const s = sorts.nth(i); if (!(await s.isVisible())) continue;
      const body = s.locator('xpath=ancestor::table[1]/tbody'), before = await body.innerText();
      await s.scrollIntoViewIfNeeded(); await s.click(); await page.waitForTimeout(400);
      if (before === await body.innerText().catch(() => before)) report('sort-does-nothing', `${tab} ${(await s.innerText()).trim().slice(0, 24)}`);
    }
  }
  const tipEvents = await page.evaluate(() => { const t = document.createElement('div'); t.className = 'season-tip'; document.body.append(t); const v = getComputedStyle(t).pointerEvents; t.remove(); return v; });
  if (tipEvents !== 'none') report('tooltip-takes-pointer', `pointer-events: ${tipEvents}`);
}

const browserType = playwright[arg('--browser', 'chromium')];
const browser = await browserType.launch();
const all = [];
try {
  for (const [state, go] of Object.entries(STATES)) {
    if (only && state !== only) continue;
    for (const [w, h, theme] of [[1440, 1000, 'dark'], [390, 844, 'light']]) {
      const page = await browser.newPage({viewport: {width: w, height: h}});
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(t => { try { localStorage.setItem('apex-theme', t); } catch {} }, theme);
      try {
        await go(page);
        for (const f of await page.evaluate(checks)) all.push({where: `${state}@${w}`, ...f});
        if (shots) { fs.mkdirSync(shots, {recursive: true}); await page.screenshot({path: path.join(shots, `${state}-${w}.png`), fullPage: true}); }
      } catch (e) { all.push({where: `${state}@${w}`, kind: 'state-failed', el: '', text: '', detail: e.message.slice(0, 160)}); }
      for (const e of errors) all.push({where: `${state}@${w}`, kind: 'script-error', el: '', text: '', detail: e.slice(0, 160)});
      await page.close();
    }
  }
  if (!only) for (const [w, h] of [[1440, 1000], [390, 844]]) {
    const page = await browser.newPage({viewport: {width: w, height: h}});
    await interactions(page, (kind, detail) => all.push({where: `interactions@${w}`, kind, el: '', text: '', detail}));
    await page.close();
  }
} finally { await browser.close(); server.kill(); }

const distinct = new Map();
for (const f of all) { const k = `${f.kind.padEnd(22)} ${f.el} «${f.text}» ${f.detail}`; distinct.set(k, [...(distinct.get(k) || []), f.where]); }
for (const [k, where] of distinct) console.log(`${k}  [${[...new Set(where)].slice(0, 4).join(', ')}]`);
console.log(`${Object.keys(STATES).length} states × 2 widths + interactions · ${distinct.size} distinct findings`);
if (verbose) console.log(JSON.stringify(all, null, 1));
process.exitCode = distinct.size ? 1 : 0;
