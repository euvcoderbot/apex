import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';

export const SECTIONS = ['status-message-wrapping', 'window-toolbar-and-sidebar', 'push-buttons', 'segmented-choices', 'checkboxes-and-radios',
  'fields-and-pop-up-menu', 'selection-and-source-lists', 'tabs-and-disclosure', 'trace-toolbar-and-colour-well', 'tables-and-sorting',
  'progress-and-feedback', 'empty-state', 'materials', 'popover-and-sheet', 'chart-legend', 'long-labels', 'verification'];

const calendar = readFileSync(new URL('./fixtures/events-2026.json', import.meta.url), 'utf8');

/** The page with no network behind it: a fixed calendar, no API, and no probe of a local dashboard. */
export async function isolate(page) {
  await page.route(/127\.0\.0\.1:54123/, route => route.abort());
  await page.route('**/assets/data/events/*.json', route => route.fulfill({contentType: 'application/json', body: calendar}));
  await page.route('**/api/events**', route => route.fulfill({contentType: 'application/json', body: calendar}));
  await page.route('**/api/**', route => route.fulfill({status: 404, contentType: 'application/json', body: '{"detail":"not available in tests"}'}));
}

/** Chromium only: the DevTools protocol is the one way to emulate prefers-reduced-transparency. */
export async function emulateChromiumMedia(page, features) {
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setEmulatedMedia', {features});
}

export const alpha = colour => {
  const match = /\/\s*([\d.]+)\s*\)/.exec(colour) || /rgba\([^)]*,\s*([\d.]+)\)/.exec(colour);
  return match ? Number(match[1]) : 1;
};

/** The API key a request is stored under: path and sorted query, with cache-busters and the /api/data envelope removed. */
export const apiKey = url => {
  const parsed = new URL(url);
  if (parsed.pathname === '/api/data') return apiKey(new URL(parsed.searchParams.get('path'), parsed.origin).href);
  for (const name of ['fresh', 'refresh', '_t', 't']) parsed.searchParams.delete(name);
  parsed.searchParams.sort();
  return parsed.pathname + '?' + parsed.searchParams;
};

/** Real answers recorded by scripts/record-fixture.mjs: Bahrain, Singapore and United States 2026, Qualifying and Race. */
export function replayFixture(page, file = 'car-performance.json.gz') {
  const answers = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/' + file, import.meta.url))));
  // The calendar is also read from a static file; give it the recorded one so the three races exist.
  const events = answers['/api/events?year=2026'];
  page.route('**/assets/data/events/*.json', route => route.fulfill({contentType: 'application/json', body: JSON.stringify(events)}));
  return page.route('**/api/**', route => {
    const found = answers[apiKey(route.request().url())];
    return found === undefined
      ? route.fulfill({status: 404, contentType: 'application/json', body: '{"detail":"not recorded"}'})
      : route.fulfill({contentType: 'application/json', body: JSON.stringify(found)});
  });
}
