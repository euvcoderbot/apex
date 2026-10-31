import {test, expect} from '@playwright/test';
import {isolate, replayFixture} from './helpers.mjs';

// Car performance with real numbers (Bahrain, Singapore and United States 2026), replayed with no network. These are the views a
// person actually reads; the catalogue shows the controls, these show what they are used for.
const CATEGORIES = [['pace', 'Pace'], ['corners', 'Cornering'], ['straight', 'Straight line'], ['braking', 'Braking'], ['pits', 'Pit stops'],
  ['tyres', 'Tyre trend'], ['trend', 'Development'], ['results', 'Reliability']];
const URL = category => `/apex/cars/${category}?year=2026&scope=tracks&races=16,17,18&run=1`;

async function open(page, category = 'pace') {
  await isolate(page);
  await replayFixture(page);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(URL(category));
  await expect(page.locator('#performanceMetricPanel')).toBeVisible({timeout: 30_000});
  await expect(page.locator('#performanceMetricPanel')).not.toHaveAttribute('aria-busy', 'true', {timeout: 30_000});
  await page.waitForLoadState('networkidle');
  return errors;
}

test.describe('Car performance with real data', () => {
  for (const [slug, label] of CATEGORIES) {
    test(`${label} shows results for three Grands Prix and nothing is cut off`, async ({page}) => {
      const errors = await open(page, slug);
      expect(errors, 'no uncaught errors').toEqual([]);
      await expect(page.locator('.category-tab[aria-current="page"]')).toHaveAttribute('aria-label', new RegExp(label.split(' ')[0], 'i'));
      const panel = page.locator('#performanceMetricPanel');
      expect((await panel.innerText()).replace(/\s+/g, ' ').length, 'the panel has content').toBeGreaterThan(200);
      expect(await page.locator('#performanceMetricPanel .performance-error').count(), 'no failure banner for recorded races').toBe(0);
      // Nothing may spill out of the page, and no text may be clipped by its own box.
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 'page scrolls sideways').toBeLessThanOrEqual(0);
      const clipped = await page.evaluate(() => [...document.querySelectorAll('#performanceMetricPanel h2, #performanceMetricPanel h3, #performanceMetricPanel th, #performanceMetricPanel button')]
        .filter(el => el.offsetParent && getComputedStyle(el).overflow !== 'visible' && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).textOverflow !== 'ellipsis')
        .map(el => (el.textContent || '').trim().slice(0, 40)));
      expect(clipped, 'text clipped without an ellipsis').toEqual([]);
    });
  }

  test('team names are the real teams, once each, in the pace chart', async ({page}) => {
    await open(page, 'pace');
    const names = await page.locator('#performanceMetricPanel .performance-bar-label').evaluateAll(list => list.map(el => el.textContent.trim()));
    expect(names.length).toBeGreaterThanOrEqual(11);
    for (const team of ['Ferrari', 'McLaren', 'Mercedes', 'Red Bull Racing']) expect(names, team).toContain(team);
  });

  test('bar charts keep one value column: every value is right-aligned to the same edge', async ({page}) => {
    await open(page, 'pace');
    const card = page.locator('#performanceMetricPanel .performance-chart-card').first();
    const edges = await card.locator('.performance-bar-val').evaluateAll(list => list.map(el => Math.round(el.getBoundingClientRect().right)));
    expect(edges.length).toBeGreaterThan(8);
    expect(new Set(edges).size, `right edges ${[...new Set(edges)]}`).toBe(1);
  });

  test('the category bar works from the keyboard', async ({page}) => {
    await open(page, 'pace');
    const tabs = page.locator('.category-bar [role="tab"]');
    await tabs.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.category-bar [role="tab"]:focus')).toHaveCount(1);
  });

  test('every view fits a phone: no sideways scroll at 390 px', async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    for (const [slug] of CATEGORIES) {
      await open(page, slug);
      // Charts finish laying out a moment after the network goes quiet, so let the width settle before judging it.
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth), {message: slug, timeout: 5000}).toBeLessThanOrEqual(0);
    }
  });
  test('nothing is cut off and no blank band sits above the category tabs', async ({page}) => {
    await page.setViewportSize({width: 1440, height: 900});
    await open(page, 'pits');
    const report = await page.evaluate(() => {
      const header = document.querySelector('.site-header').getBoundingClientRect().bottom, bar = document.querySelector('#carPerformance > .category-bar');
      return {
        gap: bar.getBoundingClientRect().top - header,
        truncated: [...bar.querySelectorAll('.category-tab span')].filter(el => el.offsetParent && el.scrollWidth > el.clientWidth + 1).map(el => el.textContent),
        hiddenScroll: [...document.querySelectorAll('#performanceMetricPanel .performance-split-view .performance-table-wrap')].filter(el => el.offsetParent).map(el => el.scrollWidth - el.clientWidth),
      };
    });
    expect(report.gap, 'space between the toolbar and the tabs').toBeLessThanOrEqual(24);
    expect(report.truncated, 'category labels cut short').toEqual([]);
    for (const overflow of report.hiddenScroll) expect(overflow, 'table columns hidden behind a scroll').toBeLessThanOrEqual(1);
  });

  test('layout stays put while the data arrives (CLS under the 0.1 "good" limit)', async ({page, browserName}) => {
    test.skip(browserName !== 'chromium', 'layout-shift entries exist only in Chromium');
    await page.addInitScript(() => {
      window.__cls = 0;
      new PerformanceObserver(list => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; })
        .observe({type: 'layout-shift', buffered: true});
    });
    for (const [slug] of CATEGORIES) {
      await open(page, slug);
      await page.waitForTimeout(500);
      expect(await page.evaluate(() => window.__cls), slug).toBeLessThan(0.1);
    }
  });
});
