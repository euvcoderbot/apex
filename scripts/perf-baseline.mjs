// Measures page-load metrics for the main views against the recorded fixture, so a later change can be compared with numbers.
//
//   node scripts/perf-baseline.mjs [origin]
//
// Chromium only (LCP, layout shift and long-task entries). Each view is loaded RUNS times with a cold cache; the median is printed.
import {chromium} from '@playwright/test';
import {replayFixture} from '../e2e/helpers.mjs';

const origin = process.argv[2] || 'http://127.0.0.1:4173';
const RUNS = 5;
const views = {'home': '/apex', 'cars (pace)': '/apex/cars/pace?year=2026&scope=tracks&races=16,17,18&run=1', 'cars (cornering)': '/apex/cars/corners?year=2026&scope=tracks&races=16,17,18&run=1'};
const median = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

const browser = await chromium.launch();
for (const [name, path] of Object.entries(views)) {
  const rows = [];
  for (let i = 0; i < RUNS; i++) {
    const context = await browser.newContext({viewport: {width: 1440, height: 900}});
    const page = await context.newPage();
    await replayFixture(page);
    await page.addInitScript(() => {
      window.__m = {lcp: 0, cls: 0, longMs: 0};
      new PerformanceObserver(l => { for (const e of l.getEntries()) window.__m.lcp = e.startTime; }).observe({type: 'largest-contentful-paint', buffered: true});
      new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__m.cls += e.value; }).observe({type: 'layout-shift', buffered: true});
      new PerformanceObserver(l => { for (const e of l.getEntries()) window.__m.longMs += Math.max(0, e.duration - 50); }).observe({type: 'longtask', buffered: true});
    });
    await page.goto(origin + path);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    const m = await page.evaluate(() => ({...window.__m, bytes: performance.getEntriesByType('resource').reduce((s, r) => s + (r.transferSize || 0), 0)}));
    rows.push(m);
    await context.close();
  }
  const f = k => median(rows.map(r => r[k]));
  console.log(`${name.padEnd(18)} LCP ${f('lcp').toFixed(0)} ms | CLS ${f('cls').toFixed(3)} | blocking ${f('longMs').toFixed(0)} ms | transferred ${(f('bytes') / 1024).toFixed(0)} KB`);
}
await browser.close();
