import {test, expect} from '@playwright/test';

test('power-unit sort indicates its default, reverses with the keyboard and keeps focus', async ({page}) => {
  await page.goto('/apex/season/units?year=2026');
  const table = page.locator('.season-units:not(.season-reliability)').first();
  const total = table.getByRole('columnheader', {name: 'Total', exact: true});
  await expect(total).toHaveAttribute('aria-sort', 'descending');
  const button = total.getByRole('button');
  await button.focus();
  await button.press('Enter');
  await expect(total).toHaveAttribute('aria-sort', 'ascending');
  await expect(button).toBeFocused();
  const values = await table.locator('tbody tr td:last-child').allTextContents();
  expect(values.map(Number)).toEqual(values.map(Number).sort((a, b) => a - b));
  await button.press('Space');
  await expect(total).toHaveAttribute('aria-sort', 'descending');
  await expect(button).toBeFocused();
  await page.getByRole('group', {name: 'Group by', exact: true}).getByRole('button', {name: 'Teams', exact: true}).click();
  await expect(table.getByRole('columnheader', {name: 'Total per car', exact: true})).toHaveAttribute('aria-sort', 'descending');
});

test('allocation sort falls back safely when a historical snapshot omits allowances', async ({page}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/apex/season/units?year=2026');
  const reliability = page.locator('.season-reliability');
  await reliability.getByRole('button', {name: 'Sort by Over allocation', exact: true}).click();
  await expect(reliability.getByRole('columnheader', {name: 'Over allocation', exact: true})).toHaveAttribute('aria-sort', 'descending');
  await page.locator('#seasonYear').selectOption('2025', {force: true});
  await expect(reliability).toBeVisible();
  await expect(reliability.getByRole('columnheader', {name: 'Over allocation', exact: true})).toHaveCount(0);
  await expect(reliability.locator('tbody tr').first()).toBeVisible();
  expect(errors).toEqual([]);
});
