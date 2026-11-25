// The straights-against-corners plot is drawn at the card's width on a phone too, and a label at the right edge moves to
// its dot's left: every team name stays inside the card.
import {test, expect} from '@playwright/test';
import {isolate, replayFixture} from './helpers.mjs';
for (const width of [390, 1440]) test.describe(`scatter ${width}`, () => {
  test.use({viewport: {width, height: 900}});
  test(`scatter labels fit at ${width}`, async ({page}, info) => {
    test.setTimeout(90000);
    await isolate(page); await replayFixture(page);
    await page.goto('/apex/cars/pace?year=2026&scope=tracks&races=16,17,18&run=1');
    const plot = page.locator('svg.trade-off-plot');
    await expect(plot).toBeVisible({timeout: 60000});
    await page.waitForLoadState('networkidle');
    const out = await plot.evaluate(svg => { const b = svg.closest('.performance-chart-card').getBoundingClientRect(); return [...svg.querySelectorAll('text.label')].filter(t => { const r = t.getBoundingClientRect(); return r.right > b.right + 1 || r.left < b.left - 1; }).map(t => t.textContent); });
    await plot.screenshot({path: info.outputPath('scatter.png')});
    expect(out).toEqual([]);
  });
});
