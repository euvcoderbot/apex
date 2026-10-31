import {test, expect} from '@playwright/test';
import {isolate, replayFixture} from './helpers.mjs';

// Car performance with real data, every category, in both appearances. Screenshots are per operating system and browser; run on
// demand: npm run test:visual, and npm run test:visual -- --update-snapshots to refresh.
const CATEGORIES = ['pace', 'corners', 'straight', 'braking', 'pits', 'tyres', 'trend', 'results'];

for (const theme of ['dark', 'light']) {
  test.describe(`car performance with data, ${theme} @visual`, () => {
    for (const category of CATEGORIES) {
      test(category, async ({page}) => {
        await page.setViewportSize({width: 1440, height: 900});
        await isolate(page);
        await replayFixture(page);
        await page.addInitScript(value => localStorage.setItem('apex-theme', value), theme);
        await page.goto(`/apex/cars/${category}?year=2026&scope=tracks&races=16,17,18&run=1`);
        await expect(page.locator('#performanceMetricPanel')).not.toHaveAttribute('aria-busy', 'true', {timeout: 30_000});
        await page.waitForLoadState('networkidle');
        // The page keeps drawing for a moment after the network is quiet; wait until its height has stopped changing.
        let last = -1;
        for (let steady = 0; steady < 3;) {
          await page.waitForTimeout(500);
          const height = await page.locator('#carPerformance').evaluate(el => el.scrollHeight);
          steady = height === last ? steady + 1 : 0;
          last = height;
        }
        await expect(page.locator('#carPerformance')).toHaveScreenshot(`${theme}-${category}.png`, {mask: [page.locator('.local-compute-status')]});
      });
    }
  });
}
