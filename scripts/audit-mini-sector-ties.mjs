// Resampling check behind miniSectorTieSeconds (session-corners.js): loads the 2026 Singapore qualifying fixture with two
// laps, drops every other telemetry packet (each phase), realigns, and reports how much each segment's time gap moved.
// Usage: node scripts/serve-static.mjs 54140 & node scripts/audit-mini-sector-ties.mjs 54140
import {chromium} from 'playwright';
import {isolate, replayFixture} from '../e2e/helpers.mjs';
const port = process.argv[2] || '54140';
const browser = await chromium.launch();
const page = await (await browser.newContext({viewport: {width: 1440, height: 1000}})).newPage();
await isolate(page); await replayFixture(page, 'session-view.json.gz');
await page.goto(`http://127.0.0.1:${port}/apex?year=2026`); await page.waitForSelector('#gp option', {state: 'attached'});
await page.evaluate(() => { const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change', {bubbles: true})); }; set('gp', '16'); set('session', 'Qualifying'); });
await page.click('#loadSession'); const pills = page.locator('#driverPills button'); await pills.nth(4).waitFor({timeout: 30000});
for (const i of [0, 4]) await pills.nth(i).click();
await page.locator('#lapWorkspaceToggle').click(); await page.click('#compareAllFastest');
await page.locator('.driver-run-card').nth(1).waitFor({timeout: 30000}); await page.keyboard.press('Escape'); await page.waitForTimeout(1500);
console.log(JSON.stringify(await page.evaluate(`(() => {
  const keys = loaded.map(l => telemetryKey(l)), full = keys.map(k => telemetryCache.get(k)), total = referenceDistance();
  const base = new Map([25, 230].map(len => [len, miniSectorDominanceSegments(full, total, len).map(s => s.durations)]));
  const results = {};
  for (const phase of [0, 1]) {
    keys.forEach((k, i) => {
      const s = full[i], kept = s.filter((p, j) => j === 0 || j === s.length - 1 || j % 2 === phase);
      telemetryCache.set(k, normalizeTelemetry(kept.map(p => ({...p, Throttle: p.RawThrottle ?? p.Throttle})), loaded[i], s.source));
    });
    prepareTelemetryAlignment();
    const now = keys.map(k => telemetryCache.get(k));
    for (const [len, before] of base) {
      const changes = [];
      miniSectorDominanceSegments(now, total, len).forEach((s, j) => {
        const b = before[j]; if (!b || !s.durations.every(Number.isFinite) || !b.every(Number.isFinite)) return;
        changes.push(Math.abs((s.durations[1] - s.durations[0]) - (b[1] - b[0])) * 1000);
      });
      changes.sort((a, b) => a - b);
      const q = p => +changes[Math.floor(p * (changes.length - 1))].toFixed(2);
      (results[len + ' m'] ||= []).push({phase, segments: changes.length, p50_ms: q(.5), p90_ms: q(.9), p95_ms: q(.95)});
    }
  }
  keys.forEach((k, i) => telemetryCache.set(k, full[i])); prepareTelemetryAlignment();
  return {laps: loaded.map(l => l.code + ' L' + l.lap), lapMetres: Math.round(total), halfRateGapChange: results};
})()`), null, 1));
await browser.close();
