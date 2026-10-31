import {readFileSync} from 'node:fs';

export const SECTIONS = ['status-message-wrapping', 'window-toolbar-and-sidebar', 'push-buttons', 'segmented-choices', 'checkboxes-and-radios',
  'fields-and-pop-up-menu', 'selection-and-source-lists', 'tabs-and-disclosure', 'trace-toolbar-and-colour-well', 'tables-and-sorting',
  'progress-and-feedback', 'empty-state', 'materials', 'popover-and-sheet', 'chart-legend', 'verification'];

const calendar = readFileSync(new URL('./fixtures/events-2026.json', import.meta.url), 'utf8');

/** The page with no network behind it: a fixed calendar, no API, and no probe of a local dashboard. */
export async function isolate(page) {
  // Real published indexes must not override the calendar fixture.
  await page.route(/\/assets\/data\/(local-captures|prerendered)\/index\.json/, route => route.fulfill({contentType:'application/json',body:'{"entries":{}}'}));
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
