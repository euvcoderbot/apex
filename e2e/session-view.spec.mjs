import {test, expect} from '@playwright/test';
import {isolate, replayFixture} from './helpers.mjs';

// Session analysis with real numbers (Bahrain 2026 qualifying, VER against LEC on their fastest laps), replayed with no network.
async function open(page) {
  await isolate(page);
  await replayFixture(page, 'session-view.json.gz');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__cls = 0;
    try { new PerformanceObserver(list => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({type: 'layout-shift', buffered: true}); } catch { /* not supported */ }
  });
  await page.goto('/apex?year=2026');
  await page.waitForSelector('#gp option', {state: 'attached'});
  await page.evaluate(() => {
    const set = (id, value) => { const el = document.getElementById(id); el.value = value; el.dispatchEvent(new Event('change', {bubbles: true})); };
    set('gp', '16'); set('session', 'Qualifying');
  });
  await page.click('#loadSession');
  const pills = page.locator('#driverPills button');
  await expect(pills.nth(4)).toBeVisible({timeout: 30_000});
  await pills.nth(0).click(); await pills.nth(4).click();
  await page.click('#compareAllFastest');
  await expect(page.locator('.driver-run-card')).toHaveCount(2, {timeout: 30_000});
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  return errors;
}

test('two laps compared: cards, charts, no errors, nothing spills sideways', async ({page}) => {
  const errors = await open(page);
  expect(errors, 'no uncaught errors').toEqual([]);
  await expect(page.locator('.driver-run-card').first()).toContainText('1:35.130');
  await expect(page.locator('.driver-run-card').nth(1)).toContainText('1:35.666');
  expect(await page.locator('canvas').count(), 'speed, delta, throttle, brake, gear and the map').toBeGreaterThanOrEqual(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 'page scrolls sideways').toBeLessThanOrEqual(0);
  const broken = await page.evaluate(() => [...document.images].filter(img => img.offsetParent && img.complete && img.naturalWidth === 0).map(img => img.src.split('/').pop()));
  expect(broken, 'images that failed to load').toEqual([]);
});

test('layout stays put while the laps load (CLS under 0.1)', async ({page, browserName}) => {
  test.skip(browserName !== 'chromium', 'layout-shift entries exist only in Chromium');
  await open(page);
  expect(await page.evaluate(() => window.__cls)).toBeLessThan(0.1);
});

test('team marks are real marks, and the monochrome ones follow the appearance', async ({page}) => {
  await open(page);
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    const marks = await page.evaluate(() => [...document.querySelectorAll('.team-logo-official')].filter(el => el.offsetParent).map(el => {
      const shown = [...el.children].find(img => getComputedStyle(img).display !== 'none');
      return {team: el.dataset.teamMark, src: shown?.getAttribute('src').split('/').pop(), width: shown?.getBoundingClientRect().width};
    }));
    expect(marks.length, `${theme}: marks on the page`).toBeGreaterThan(0);
    for (const mark of marks) { expect(mark.src, `${theme} ${mark.team} shows an image`).toBeTruthy(); expect(mark.width).toBeGreaterThan(0); }
  }
});
