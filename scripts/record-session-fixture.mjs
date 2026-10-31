// Records the API answers behind one real Session analysis run (Bahrain 2026 qualifying, VER against LEC, fastest laps) so the end-to-end
// tests can drive the session view with real numbers and no network.
//
//   node scripts/record-session-fixture.mjs [origin] [output]
import {chromium} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {apiKey} from '../e2e/helpers.mjs';

const origin = process.argv[2] || 'http://127.0.0.1:54123';
const output = process.argv[3] || 'e2e/fixtures/session-view.json.gz';
const recorded = {};
const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
page.on('response', async response => {
  const url = response.url();
  if (!url.startsWith(origin + '/api/') || response.status() !== 200 || /local-(status|tab|stop)/.test(url)) return;
  try { recorded[apiKey(url)] = await response.json(); } catch { /* not JSON */ }
});
await page.goto(`${origin}/apex?year=2026`);
await page.waitForSelector('#gp option', {state: 'attached'});
await page.evaluate(() => {
  const set = (id, value) => { const el = document.getElementById(id); el.value = value; el.dispatchEvent(new Event('change', {bubbles: true})); };
  set('gp', '16'); set('session', 'Qualifying');
});
await page.click('#loadSession');
const pills = page.locator('#driverPills button');
await pills.nth(0).waitFor({timeout: 60_000});
await pills.nth(0).click(); await pills.nth(4).click();
await page.click('#compareAllFastest');
await page.locator('.driver-run-card').nth(1).waitFor({timeout: 120_000});
for (let quiet = 0, seen = -1; quiet < 15;) {
  await page.waitForTimeout(1000);
  const count = Object.keys(recorded).length;
  quiet = count === seen ? quiet + 1 : 0; seen = count;
}
await browser.close();
const body = gzipSync(JSON.stringify(recorded), {level: 9});
writeFileSync(output, body);
console.log(`${Object.keys(recorded).length} answers, ${(body.length / 1024).toFixed(0)} KB compressed`);
