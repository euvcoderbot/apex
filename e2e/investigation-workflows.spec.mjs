import {test, expect} from '@playwright/test';
import {isolate, replayFixture} from './helpers.mjs';

test('historical standings follow the selected round for drivers and constructors', async ({page}) => {
  await page.goto('/apex/season/standings?year=2026');
  const picker = page.locator('select[aria-label="Standings after Grand Prix"]');
  const first = await picker.locator('option').last().getAttribute('value');
  const points = page.locator('.season-standings tbody tr').first().locator('td.season-points');
  const latest = await points.innerText();
  await picker.selectOption(first, {force: true});
  await expect(points).not.toHaveText(latest);
  await page.getByRole('button', {name: 'Constructors', exact: true}).click();
  await expect(picker).toHaveValue(first);
  await expect(page.locator('.season-title-fight')).toHaveCount(0);
});

test('entrant comparison copies measurements from the selected field and keeps distinct entrants', async ({page}, info) => {
  await isolate(page); await replayFixture(page);
  await page.goto('/apex/cars?year=2026&scope=tracks&races=16,17,18&run=1');
  const box = page.locator('.entrant-comparison');
  await box.locator('summary').click();
  const picks = box.locator('select');
  const second = await picks.nth(1).inputValue();
  await picks.first().selectOption(second, {force: true});
  await expect(picks.nth(1)).not.toHaveValue(second);
  await expect(box.locator('thead th').nth(1)).toHaveText(second);
  const firstChart = page.locator('.performance-chart-card').filter({has: page.locator('.performance-bar-row')}).first();
  await expect(firstChart.locator('.performance-quality-status')).toHaveText(/\d+ shared GPs/);
  await expect(firstChart.locator('.performance-bar-row').first()).toHaveAttribute('aria-label', /shared GP.*provisional/);
  const fieldRow = firstChart.locator('.performance-bar-row').filter({has: page.getByText(second, {exact:true})}).first();
  await expect(box.locator('tbody tr').first().locator('td').first()).toHaveText(await fieldRow.locator('.performance-bar-val').innerText());
  await box.scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath('entrant-comparison.png')});
});

test.describe('phone investigation', () => {
  test.use({viewport:{width:390, height:844}});
  test('inspect tyre laps and follow a development round on a phone', async ({page}, info) => {
    await isolate(page); await replayFixture(page);
    await page.goto('/apex/cars/tyres?year=2026&scope=tracks&races=16,17,18&run=1');
    await page.getByRole('button', {name:'Inspect a stint'}).click();
    const plot = page.locator('.performance-tyre-stint-plot');
    await expect(plot).toBeVisible();
    const sensitivity = page.getByRole('region', {name:'Fuel sensitivity'});
    await expect(sensitivity.getByRole('columnheader')).toHaveText(['Fuel assumption', 'Slope (s/lap)']);
    await expect(sensitivity.locator('tbody td:first-child')).toHaveText(['Observed', '+0.03 s/lap fuel gain', '+0.06 s/lap fuel gain', '+0.09 s/lap fuel gain']);
    await sensitivity.screenshot({path:info.outputPath('fuel-sensitivity-phone.png')});
    await plot.locator('summary').click();
    await expect(plot.locator('tbody tr').first()).toBeVisible();
    await plot.scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath('stint-phone.png')});
    const measurement = page.locator('.car-category-picker');
    await expect(measurement).toBeVisible();
    await measurement.locator('select').selectOption('trend', {force:true});
    const round = page.locator('[data-trend-round]');
    await round.selectOption('17', {force:true});
    await expect(page.getByRole('heading', {name:'Round 17 qualifying gaps'})).toBeVisible();
    const link = page.getByRole('link', {name:'Open qualifying laps'});
    await expect(link).toHaveAttribute('href', /round=17/);
    await expect(page.getByRole('link', {name:'Season upgrade declarations'})).toHaveAttribute('href', /season\/upgrades\?year=2026/);
    await link.click();
    await expect(page).toHaveURL(/session=Qualifying/);
  });
});
