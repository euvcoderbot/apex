import {test, expect} from '@playwright/test';
import {apiKey, isolate, replayFixture} from './helpers.mjs';

test('Season announces loading and an unavailable-data failure', async ({page}) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/assets/data/season/index.json', route => route.fulfill({json: {entries: {}}}));
  await page.route('**/api/**', async route => {
    if (apiKey(route.request().url()).startsWith('/api/season?')) { await gate; return route.fulfill({status: 404, json: {detail: 'Season data unavailable'}}); }
    return route.fulfill({status: 404, json: {detail: 'Not available'}});
  });
  try {
    await page.goto('/apex/season/standings?year=2026', {waitUntil: 'domcontentloaded'});
    await expect(page.locator('#seasonHub .season-body')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#seasonHub').getByRole('status')).toContainText('Loading');
  } finally { release(); }
  await expect(page.locator('#seasonHub').getByRole('alert')).toContainText('Season data unavailable');
  await expect(page.locator('#seasonHub .season-body')).toHaveAttribute('aria-busy', 'false');
});

test('pit timing failures and retry stay visible when explanations are hidden', async ({page}) => {
  await isolate(page); await replayFixture(page);
  await page.route('**/api/**', route => apiKey(route.request().url()).startsWith('/api/performance/pits?')
    ? route.fulfill({status: 404, json: {detail: 'Timing unavailable in test'}}) : route.fallback());
  await page.goto('/apex/cars/pits?year=2026&scope=tracks&races=16,17,18&run=1');
  await expect(page.locator('#performanceMetricPanel')).not.toHaveAttribute('aria-busy', 'true');
  if (!await page.locator('body').evaluate(node => node.classList.contains('is-descriptions-hidden'))) await page.locator('#explanationsToggle').click();
  await expect(page.locator('#performanceMetricPanel').getByRole('alert')).toContainText('Timing unavailable in test');
  await expect(page.getByRole('button', {name: 'Retry unavailable', exact: true})).toBeVisible();
});
