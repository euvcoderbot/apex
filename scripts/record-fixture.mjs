// Records the API answers behind a real Car performance run into a compact fixture, so the end-to-end tests can drive the
// finished views (charts, tables, categories) with real numbers and no network.
//
//   node scripts/record-fixture.mjs [origin] [output]
//
// It opens the page of a running local server, runs the analysis for three Grands Prix, and keeps every successful /api answer
// keyed by its path and sorted query. The tests replay them (e2e/helpers.mjs, replayFixture).
import {chromium} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';

const origin = process.argv[2] || 'http://127.0.0.1:54123';
const output = process.argv[3] || 'e2e/fixtures/car-performance.json.gz';
const races = process.env.RACES || '16,17,18';

export const key = url => {
  const parsed = new URL(url);
  if (parsed.pathname === '/api/data') return key(new URL(parsed.searchParams.get('path'), parsed.origin).href);
  for (const name of ['fresh', 'refresh', '_t', 't']) parsed.searchParams.delete(name);
  parsed.searchParams.sort();
  return parsed.pathname + '?' + parsed.searchParams;
};

const recorded = {};
const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 1440, height: 900}});
page.on('response', async response => {
  const url = response.url();
  if (!url.startsWith(origin + '/api/') || response.status() !== 200 || /local-(status|tab|stop)/.test(url)) return;
  try { recorded[key(url)] = await response.json(); } catch { /* not JSON */ }
});
await page.goto(`${origin}/apex/cars?year=2026&scope=tracks&races=${races}&run=1`);
// The analysis is finished when nothing new has been asked for in 25 seconds.
let seen = -1;
const settle = async () => {
  for (let quiet = 0; quiet < 25;) {
    await page.waitForTimeout(1000);
    const count = Object.keys(recorded).length;
    quiet = count === seen ? quiet + 1 : 0;
    seen = count;
  }
};
await settle();
for (const category of ['corners', 'straight', 'braking', 'pits', 'tyres', 'trend', 'results']) {
  await page.goto(`${origin}/apex/cars/${category}?year=2026&scope=tracks&races=${races}&run=1`);
  await settle();
}
await browser.close();
const body = gzipSync(JSON.stringify(recorded), {level: 9});
writeFileSync(output, body);
console.log(`${Object.keys(recorded).length} answers, ${(body.length / 1024).toFixed(0)} KB compressed`);
for (const k of Object.keys(recorded).slice(0, 40)) console.log(' ', k.slice(0, 110));
