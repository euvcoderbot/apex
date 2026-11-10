import {test, expect} from '@playwright/test';
import {isolate, replayFixture} from './helpers.mjs';

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
