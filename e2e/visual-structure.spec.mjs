import {test, expect} from '@playwright/test';
import {isolate, replayFixture} from './helpers.mjs';

for (const theme of ['dark', 'light']) for (const width of [1440, 390]) {
  test.describe(`${theme} ${width} visual structure`, () => {
    test.use({viewport: {width, height: 1000}});
    test('comparison bars sit on one line with their name and value, and the folded race picker stays compact', async ({page}) => {
      await isolate(page); await replayFixture(page);
      await page.addInitScript(t => localStorage.setItem('apex-theme', t), theme);
      await page.goto('/apex/cars/pace?year=2026&scope=tracks&races=16,17,18&run=1');
      await expect(page.locator('#performanceMetricPanel')).not.toHaveAttribute('aria-busy', 'true');
      await page.waitForLoadState('networkidle');
      const row = page.locator('.performance-visual-grid .performance-bar-row').first();
      await expect(row).toBeVisible();
      await expect.poll(() => row.evaluate(node => {
        const box = node.getBoundingClientRect(), label = node.querySelector('.performance-bar-label').getBoundingClientRect();
        const track = node.querySelector('.performance-bar-track').getBoundingClientRect(), value = node.querySelector('.performance-bar-val').getBoundingClientRect();
        // One line per entrant: name, then the bar, then the value, all centred on the same line.
        const mid = r => r.top + r.height / 2;
        return box.width > 0 && label.right <= track.left && track.right <= value.left && track.width / box.width > .2
          && Math.abs(mid(track) - mid(label)) <= 2 && Math.abs(mid(value) - mid(label)) <= 2;
      })).toBe(true);
      await expect(page.locator('#performanceSelectAllTracks')).toBeHidden();
      await page.locator('#performanceTrackToggle').click();
      await expect(page.locator('#performanceSelectAllTracks')).toBeVisible();
      await page.locator('#performanceTrackToggle').click();
      await expect(page.locator('#performanceSelectAllTracks')).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    });

    test('Standings identifies the page and gives the table a primary column', async ({page}, info) => {
      await page.addInitScript(t => localStorage.setItem('apex-theme', t), theme);
      await page.goto('/apex/season/standings?year=2026');
      await expect(page.getByRole('heading', {level: 1, name: 'Standings', exact: true})).toBeVisible();
      const table = page.locator('.season-standings');
      await expect(table).toBeVisible();
      if (width >= 1200) {
        const tab = await table.boundingBox(), insight = await page.locator('.season-title-fight').boundingBox();
        expect(insight.y).toBeGreaterThanOrEqual(tab.y + tab.height - 1);   // under the standings table
        expect(Math.abs(insight.x - tab.x)).toBeLessThan(40);                // in the same column
      } else {
        const points = await table.locator('th.season-points').boundingBox();
        expect(points.x).toBeGreaterThanOrEqual(0);
        expect(points.x + points.width).toBeLessThanOrEqual(width);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      await page.screenshot({path: info.outputPath('standings.png')});
    });
  });
}
