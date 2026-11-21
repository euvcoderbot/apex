#!/usr/bin/env node
// Accessibility audit over every route (scripts/qa-states.mjs):
//   1. axe-core, WCAG 2 A/AA rules, grouped by rule and target;
//   2. keyboard: tabs through the page and flags a focused control with no visible focus indicator (no outline, ring or
//      change of background/colour against its unfocused look);
//   3. reduced motion: with prefers-reduced-motion: reduce, flags running animations or transitions that still move or
//      scale something (fades are allowed).
//   node scripts/audit-a11y.mjs [--widths 1440] [--themes dark,light] [--only regex] [--tabs 80]
import {spawn} from 'node:child_process';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import * as playwright from 'playwright';
import {qaStates} from './qa-states.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const widths = arg('--widths', '1440').split(',').map(Number);
const themes = arg('--themes', 'dark,light').split(',');
const only = arg('--only', null) && new RegExp(arg('--only'));
const tabs = Number(arg('--tabs', 80));
const port = 54280 + Math.floor(Math.random() * 40);
const origin = `http://127.0.0.1:${port}`;
const axeSource = await readFile(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const look = el => { const s = getComputedStyle(el); return [s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 ? `o${s.outlineColor}${s.outlineWidth}` : '', s.boxShadow, s.backgroundColor, s.color, s.borderColor, s.textDecorationLine].join('|'); };

const server = spawn(process.execPath, ['scripts/serve-static.mjs', String(port)], {cwd: root, stdio: 'ignore'});
await new Promise(r => setTimeout(r, 1500));
// --browser chromium|firefox|webkit: run the same audit in another engine (cross-browser check).
const engine = process.argv.includes('--browser') ? process.argv[process.argv.indexOf('--browser') + 1] : 'chromium';
const browser = await playwright[engine].launch();
const groups = new Map();
const note = (kind, key, state, detail) => { const k = `${kind} ${key}`; const g = groups.get(k) || {count: 0, states: new Set(), detail}; g.count++; g.states.add(state); groups.set(k, g); };
let runs = 0;
try {
  for (const theme of themes) for (const width of widths) for (const [state, setup] of Object.entries(qaStates(origin))) {
    if (only && !only.test(state)) continue;
    const context = await browser.newContext({viewport: {width, height: 1000}, reducedMotion: 'reduce'});
    const page = await context.newPage();
    await page.addInitScript(t => localStorage.setItem('apex-theme', t), theme);
    try {
      await setup(page);
      runs++;
      // 1. axe
      await page.addScriptTag({content: axeSource});
      const axe = await page.evaluate(async () => (await window.axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']}, resultTypes: ['violations']})).violations
        .map(v => ({id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map(n => {
          const d = n.any?.[0]?.data;  // contrast: the measured colours and ratio, so a fix can be chosen
          return n.target.join(' ').slice(0, 90) + (d?.contrastRatio ? ` ${d.fgColor} on ${d.bgColor} = ${d.contrastRatio}:1 (${d.fontSize} ${d.fontWeight})` : '');
        })})));
      for (const v of axe) for (const n of v.nodes) note('axe', `${v.id} (${v.impact}) ${n}`, `${state}/${theme}`, v.help);
      // 2. keyboard focus visibility
      await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
      const seen = new Set();
      for (let i = 0; i < tabs; i++) {
        await page.keyboard.press('Tab');
        const r = await page.evaluate(lookSrc => {
          const look = new Function('return ' + lookSrc)();
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const id = el.id || `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`;
          // A ring may be drawn by the control's field (.control-field:has(:focus-visible), two levels up): compare ancestors too.
          const both = () => [el, el.parentElement, el.parentElement?.parentElement].filter(Boolean).map(look).join('||');
          const focused = both();
          // Unfocused look: blur, measure, refocus without scrolling.
          el.blur(); const plain = both(); el.focus({preventScroll: true, focusVisible: true});
          const ring = getComputedStyle(el);
          const r2 = el.getBoundingClientRect();
          return {id, label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30), same: focused === plain, outline: ring.outlineStyle, w: r2.width};
        }, look.toString());
        if (!r || r.w === 0) continue;
        if (seen.has(r.id + r.label)) continue; seen.add(r.id + r.label);
        if (r.same) note('focus', `${r.id} «${r.label}»`, `${state}/${theme}`, 'no visible focus indicator');
      }
      // 3. reduced motion: anything still moving
      const moving = await page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').map(a => {
        const kf = a.effect?.getKeyframes?.() || [], props = new Set(kf.flatMap(k => Object.keys(k)));
        const moves = ['transform', 'translate', 'scale', 'rotate', 'top', 'left', 'width', 'height'].some(p => props.has(p));
        const t = a.effect?.target; return moves ? `${t?.tagName?.toLowerCase()}.${String(t?.className || '').split(' ')[0]} ${a.animationName || a.transitionProperty || [...props].join(',')}` : null;
      }).filter(Boolean));
      for (const m of moving) note('motion', m, `${state}/${theme}`, 'moves although reduced motion is requested');
    } catch (e) { console.log(`! ${state} ${theme} ${width}: ${e.message.split('\n')[0]}`); }
    await context.close();
  }
} finally { await browser.close(); server.kill(); }
console.log(`${runs} renders · ${groups.size} distinct accessibility findings`);
for (const [key, g] of [...groups].sort((a, b) => b[1].count - a[1].count))
  console.log(String(g.count).padStart(4), ' ', key.slice(0, 150), ' — ', g.detail.slice(0, 70), `[${[...g.states].slice(0, 4).join(',')}${g.states.size > 4 ? ',…' : ''}]`);
process.exitCode = groups.size ? 1 : 0;
