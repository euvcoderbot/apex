import {test, expect} from '@playwright/test';
import {isolate, replayFixture} from './helpers.mjs';

// Creating the viewport up front also supports Firefox runtimes whose dynamic-resize command hangs on Windows.
for (const width of [1440, 1024, 390]) for (const theme of ['dark', 'light']) {
  test.describe(`${width}px ${theme} complete route matrix`, () => {
    test.use({viewport: {width, height: 1000}});
    test('all Season tabs and performance categories remain usable', async ({page}, info) => {
      test.setTimeout(180000);
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(t => localStorage.setItem('apex-theme', t), theme);
      const checkWidth = async label => expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), label).toBeLessThanOrEqual(1);
      for (const tab of ['schedule', 'results', 'standings', 'form', 'drivers', 'h2h', 'upgrades', 'units']) {
        await page.goto(`/apex/season/${tab}?year=2026`);
        await expect(page.locator('#seasonHub .season-body > :not(.season-loading)').first()).toBeVisible();
        await expect(page.locator('#seasonHub .season-body')).not.toContainText('Could not load');
        await expect(page.locator('#seasonHub .season-body > *').first()).toBeVisible();
        await checkWidth(`Season ${tab} ${width}`);
        const mark = page.locator('#seasonHub [data-tip]:visible').first();
        if (await mark.count()) {
          await mark.focus(); await expect(page.locator('.season-tip')).toBeVisible();
          await mark.press('Escape'); await expect(page.locator('.season-tip')).toBeHidden();
        }
        await page.screenshot({path: info.outputPath(`season-${tab}.png`)});
      }
      await isolate(page); await replayFixture(page);
      for (const metric of ['pace', 'corners', 'straight', 'braking', 'pits', 'tyres', 'trend', 'results']) {
        await page.goto(`/apex/cars/${metric}?year=2026&scope=tracks&races=16,17,18&run=1`);
        await expect(page.locator('#performanceMetricPanel')).not.toHaveAttribute('aria-busy', 'true', {timeout: 30000});
        await page.waitForLoadState('networkidle');
        await checkWidth(`Performance ${metric} ${width}`);
        const mark = page.locator('#performanceMetricPanel [data-chart-value]').first();
        if (await mark.count()) {
          await mark.focus(); await expect(page.locator('.chart-value-tip')).toBeVisible();
          await mark.press('Escape'); await expect(page.locator('.chart-value-tip')).toBeHidden();
        }
        const detail = page.locator('#performanceMetricPanel details:visible').first();
        if (await detail.count()) {
          if (await detail.evaluate(node => node.open)) await detail.locator(':scope > summary').click();
          await detail.locator(':scope > summary').focus(); await detail.locator(':scope > summary').press('Enter');
          await expect.poll(() => detail.evaluate(node => node.open)).toBe(true); await checkWidth(`Expanded ${metric} ${width}`);
        }
        await page.screenshot({path: info.outputPath(`cars-${metric}.png`)});
      }
      expect(errors).toEqual([]);
    });
  });
}
