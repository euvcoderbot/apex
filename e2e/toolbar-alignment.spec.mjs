import {test, expect} from '@playwright/test';
import {isolate, replayFixture} from './helpers.mjs';

test('ranked charts stack before their bars are squeezed by labels', async ({page}) => {
  await isolate(page); await replayFixture(page);
  await page.goto('/apex/cars/pace?year=2026&scope=tracks&races=16,17,18&run=1');
  await page.locator('#performanceMetricPanel:not([aria-busy="true"])').waitFor();
  const grid = page.locator('.performance-visual-grid').first();
  for (const [width, columns] of [[1440, 2], [1024, 1], [390, 1]]) {
    await page.setViewportSize({width, height: 1000});
    await expect.poll(() => grid.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(columns);
    const cards = grid.locator('.performance-chart-card');
    await expect.poll(async () => {
      const [first, second] = await Promise.all([cards.nth(0).boundingBox(), cards.nth(1).boundingBox()]);
      if (!first || !second) return false;
      return columns === 1 ? second.y >= first.y + first.height : Math.abs(first.y - second.y) <= 1;
    }).toBe(true);
  }
});

// The view bar's primary action (Load session, Analyse) must share the filter chips' top edge. Their rows can be taller
// than a chip, and an old rule pinned Analyse to the bottom of its box, offsetting it by 7 px (docs/linear-design-spec.md §6).
for (const [name, path, action, fixture] of [
  ['Session analysis', '/apex/?year=2026', '#loadSession', 'session-view.json.gz'],
  ['Car performance before an analysis', '/apex/cars?year=2026', '#performanceLoad', undefined],
]) {
  test(`${name}: the primary action lines up with the filter chips`, async ({page}) => {
    await isolate(page); await replayFixture(page, fixture);
    await page.goto(path);
    const chip = page.locator('.app-sidebar:visible .control-field').first();
    const button = page.locator(action);
    await expect(button).toBeVisible();
    const [a, b] = await Promise.all([chip.boundingBox(), button.boundingBox()]);
    expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(0.5);
  });
}
