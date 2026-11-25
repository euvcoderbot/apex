import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

const index = JSON.parse(readFileSync(new URL('../assets/data/season/index.json', import.meta.url)));

test('season standings render while photo metadata is still pending', async ({page}) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/assets/drivers/credits.json', async route => { await gate; await route.continue(); });
  try {
    await page.goto('/apex/season/standings?year=2026', {waitUntil: 'domcontentloaded'});
    await expect(page.locator('#seasonHub .season-card').first()).toBeVisible();
    await expect(page.locator('#seasonHub .season-avatar').first()).toBeVisible();
    await page.locator('#seasonHub .season-body').getByRole('button', {name: 'Drivers', exact: true}).focus();
  } finally { release(); }
  await expect(page.locator('#seasonHub .season-avatar img').first()).toBeAttached();
  await expect(page.locator('#seasonHub .season-credits')).toBeAttached();
  await expect(page.locator('#seasonHub .season-body').getByRole('button', {name: 'Drivers', exact: true})).toBeFocused();
});

test('schedule data renders before circuit outlines finish loading', async ({page}) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/assets/circuits/f1-circuits.geojson', async route => { await gate; await route.continue(); });
  try {
    await page.goto('/apex/season/schedule?year=2026', {waitUntil: 'domcontentloaded'});
    await expect(page.locator('#seasonHub .season-loading')).toHaveCount(0);
    await expect(page.locator('#seasonHub .season-body')).toContainText('Las Vegas');
  } finally { release(); }
  await expect(page.locator('#seasonHub svg.season-track.is-hero').first()).toBeAttached();
});

test('power-unit data starts loading alongside the main season data', async ({page}) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const core = index.entries['/api/season?year=2026'].file;
  const units = index.entries['/api/season/power-units?year=2026'].file;
  let requestedUnits = false;
  page.on('request', request => { if (request.url().includes(units)) requestedUnits = true; });
  await page.route(`**/assets/data/season/${core}`, async route => { await gate; await route.continue(); });
  try {
    await page.goto('/apex/season/units?year=2026', {waitUntil: 'domcontentloaded'});
    await expect.poll(() => requestedUnits).toBe(true);
  } finally { release(); }
  await expect(page.locator('.season-units').first()).toBeVisible();
});
