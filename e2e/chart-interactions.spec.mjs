import {test, expect} from '@playwright/test';
import {isolate, replayFixture} from './helpers.mjs';

for (const theme of ['dark', 'light']) for (const width of [1440, 390]) {
  test.describe(`${theme} ${width} chart viewport`, () => {
  test.use({viewport: {width, height: 1000}});
  test(`Season chart values support focus, arrows, Escape and bounded tooltips: ${theme} ${width}`, async ({page}) => {
    await page.addInitScript(t => localStorage.setItem('apex-theme', t), theme);
    await page.goto('/apex/season/standings?year=2026');
    const chart = page.locator('.season-chart').first(), marks = chart.locator('[data-tip]');
    await expect(marks.first()).toHaveAttribute('tabindex', '0');
    await marks.first().focus();
    const tip = page.locator('.season-tip');
    await expect(tip).toBeVisible();
    await expect(tip).toContainText((await marks.first().getAttribute('data-tip')).split('\n')[0]);
    await marks.first().press('ArrowRight');
    await expect(marks.nth(1)).toBeFocused();
    await expect(chart.locator('[data-tip][tabindex="0"]')).toHaveCount(1);
    const box = await tip.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
    await marks.nth(1).press('Escape'); await expect(tip).toBeHidden();
    const hit = await marks.nth(1).boundingBox();
    await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2); await expect(tip).toBeVisible();
    await page.mouse.move(width - 10, 10); await expect(tip).toBeHidden();
  });
  });
}

for (const metric of ['pace', 'trend', 'tyres']) {
  test(`${metric} values have a single keyboard entry per plot and reveal exact values`, async ({page}) => {
    test.setTimeout(60000);
    await isolate(page); await replayFixture(page);
    await page.goto(`/apex/cars/${metric}?year=2026&scope=tracks&races=16,17,18&run=1`);
    await expect(page.locator('#performanceMetricPanel')).not.toHaveAttribute('aria-busy', 'true');
    await page.waitForLoadState('networkidle');
    const first = page.locator('#performanceMetricPanel [data-chart-value]').first();
    await expect(first).toBeVisible();
    const initialKey = await first.getAttribute('data-chart-value');
    const mark = page.locator(`[data-chart-value=${JSON.stringify(initialKey)}]`).first();
    await mark.focus();
    const tip = page.locator('.chart-value-tip');
    await expect(tip).toHaveText(await mark.getAttribute('aria-label'));
    await expect(tip).toBeVisible();
    await mark.press('ArrowRight');
    await expect(mark).not.toBeFocused();
    const focused = page.locator('[data-chart-value]:focus');
    await expect(tip).toHaveText(await focused.getAttribute('aria-label'));
    const key = await focused.getAttribute('data-chart-value');
    await page.evaluate(() => window.dispatchEvent(new Event('apex-theme')));
    await expect(page.locator('[data-chart-value]:focus')).toHaveAttribute('data-chart-value', key);
    await focused.press('Escape'); await expect(tip).toBeHidden();
    await page.evaluate(() => window.dispatchEvent(new Event('apex-theme')));
    await expect(tip).toBeHidden();
    await page.locator('#themeToggle').focus(); await expect(tip).toBeHidden();
  });
}

test('straight-versus-corner scatter points expose their measured values to the keyboard', async ({page}) => {
  test.setTimeout(60000);
  await isolate(page); await replayFixture(page);
  await page.goto('/apex/cars/pace?year=2026&scope=tracks&races=16,17,18&run=1');
  await expect(page.locator('#performanceMetricPanel')).not.toHaveAttribute('aria-busy', 'true');
  await page.waitForLoadState('networkidle');
  const measure = page.locator('[data-profile-load]');
  if (await measure.count()) {
    if (!await measure.isVisible()) await page.locator('#explanationsToggle').click();
    await page.waitForLoadState('networkidle');
    if (await measure.count() && !await measure.isDisabled()) {
      // Enabling explanations may also finish an automatic telemetry load and replace this optional action.
      await measure.click({timeout: 2000}).catch(async error => {
        if (!await page.locator('.trade-off-plot').count()) throw error;
      });
    }
  }
  const point = page.locator('.trade-off-plot [data-chart-value]').first();
  await expect(point).toBeVisible({timeout: 15000}); await point.focus();
  await expect(page.locator('.chart-value-tip')).toHaveText(await point.getAttribute('aria-label'));
  await point.press('ArrowRight'); await expect(point).not.toBeFocused();
  await page.keyboard.press('Escape'); await expect(page.locator('.chart-value-tip')).toBeHidden();
});
