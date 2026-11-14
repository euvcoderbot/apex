import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';

const base = new URL('../assets/data/season/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', base)));
const route = '/api/season?year=2026';
const entry = index.entries[route];
const fixture = JSON.parse(gunzipSync(readFileSync(new URL(entry.file, base))));
const next = fixture.rounds.find(r => r.status === 'next');
for (const s of next.sessions) s.weather = {temp: 15, rain: 43, wind: 13, code: 2, humidity: 50, direction: 265, gust: 22, mm: 0.1};

test.beforeEach(async ({page}) => {
  await page.route('**/assets/data/season/index.json', r => r.fulfill({json: {...index, entries: {...index.entries, [route]: {...entry, saved_at: new Date().toISOString()}}}}));
  await page.route(`**/assets/data/season/${entry.file}`, r => r.fulfill({json: fixture}));
});

for (const width of [1440, 1024, 768, 390]) {
  test(`detailed session forecasts fit the panel at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 1000});
    await page.goto('/apex/');
    await expect(page.locator('.season-forecast-humid')).toHaveCount(next.sessions.length);
    const fits = await page.locator('.season-forecast').evaluate(n => n.scrollWidth <= n.clientWidth + 1);
    expect(fits).toBe(true);
    for (const cell of await page.locator('.season-forecast-humid').all()) await expect(cell).toBeVisible();
    if (width === 390) {
      expect(await page.locator('#linearWorkspace').evaluate(n => n.getBoundingClientRect().height)).toBeLessThan(120);
      const boxes = await page.locator('.linear-navigation button').evaluateAll(ns => ns.map(n => n.getBoundingClientRect().top));
      expect(Math.max(...boxes) - Math.min(...boxes)).toBeLessThan(1);
    }
  });
}

test('Tracks has its own navigation and clears selection on leaving', async ({page}) => {
  await page.goto('/apex/season/tracks?year=2026');
  const tracks = page.locator('.linear-navigation [data-season-tab="tracks"]');
  await expect(tracks).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.season-tabs')).toBeHidden();
  await page.locator('[data-analysis-view="session"]').click();
  await expect(tracks).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#seasonViewButton').click();
  await expect(page.locator('.season-tabs')).toBeVisible();
  await expect(page.locator('#seasonViewButton')).toHaveAttribute('aria-pressed', 'true');
});

for (const width of [390, 1024]) {
  test(`head-to-head keeps both drivers readable at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 1000});
    await page.goto('/apex/season/h2h?year=2026');
    const hero = page.locator('.season-h2h-hero');
    await expect(hero).toBeVisible();
    const layout = await hero.evaluate(n => {
      const sides = [...n.querySelectorAll('.season-h2h-side')].map(x => x.getBoundingClientRect());
      const score = n.querySelector('.season-h2h-score').getBoundingClientRect();
      return {widths: sides.map(x => x.width), scoreTop: score.top, sideBottom: Math.max(...sides.map(x => x.bottom))};
    });
    expect(Math.min(...layout.widths)).toBeGreaterThan(120);
    expect(layout.scoreTop).toBeGreaterThanOrEqual(layout.sideBottom - 1);
  });
}
