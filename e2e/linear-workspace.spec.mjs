import {test, expect} from '@playwright/test';
import {isolate, replayFixture} from './helpers.mjs';

async function open(page) {
  await isolate(page);
  await replayFixture(page, 'session-view.json.gz');
  await page.addInitScript(() => { localStorage.setItem('apex-theme', 'dark'); });
  await page.goto('/apex?year=2026');
  await expect(page.locator('#linearWorkspace')).toBeVisible();
  await page.waitForLoadState('networkidle');
}

test('Linear navigation reuses controls, with no other look to switch to', async ({page}) => {
  await open(page);
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'linear');
  await expect(page.locator('#skinToggle, #glassToggle, #densityToggle')).toHaveCount(0);
  await expect(page.locator('#linearWorkspace [data-analysis-view]')).toHaveCount(2);
  await expect(page.locator('#linearWorkspace #performanceCategoryList')).toHaveCount(1);
  // The first click can land before the navigation is wired up (seen in WebKit): click until the view switches.
  await expect(async () => {
    await page.locator('[data-analysis-view="performance"]').click();
    await expect(page.locator('#carPerformance')).toBeVisible({timeout: 1000});
  }).toPass({timeout: 10000});
  await expect(page.locator('#top')).toBeHidden();
  await expect(page.locator('#linearWorkspace')).toHaveAttribute('data-view', 'performance');
});

test('command search supports keyboard filtering, activation and focus restoration', async ({page}) => {
  await open(page);
  const trigger = page.locator('.linear-search');
  await trigger.click();
  await expect(page.getByRole('dialog', {name: 'Search Apex commands'})).toBeVisible();
  await page.locator('#linearCommandSearch').fill('appearance');
  await expect(page.locator('.linear-command-results button')).toHaveCount(1);
  await page.locator('#linearCommandSearch').press('ArrowDown');
  await expect(page.locator('.linear-command-results button')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Control+k');
  await expect(page.locator('#linearCommandMenu')).toBeVisible();
  await page.locator('#linearCommandSearch').fill('not a real command');
  await expect(page.locator('.linear-command-results')).toContainText('No matching commands');
  await page.keyboard.press('Escape');
  await expect(page.locator('#linearCommandMenu')).toBeHidden();
});

test('animated calendar menu stays within a short viewport', async ({page}) => {
  await page.setViewportSize({width: 1280, height: 600});
  await open(page);
  await page.locator('#gp').locator('..').locator('.select-trigger').click();
  await expect(page.locator('#gpOptions')).toBeVisible();
  await expect.poll(() => page.locator('#gpOptions').evaluate(el => {
    const rect = el.getBoundingClientRect();
    return rect.bottom <= innerHeight - 7 && rect.top >= 7;
  })).toBe(true);
  await page.locator('#gpOptions').press('Escape');
  await expect(page.locator('#gpOptions')).toBeHidden();
});

test('both themes fit desktop and mobile', async ({page}) => {
  await open(page);
  for (const width of [1440, 1024, 760, 390]) {
    await page.setViewportSize({width, height: 900});
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${width}px ${theme}`).toBeLessThanOrEqual(1);
      await expect(page.locator('#loadSession')).toBeVisible();
      await expect(page.locator('#themeToggle')).toBeVisible();
    }
  }
});

test('real recorded laps load in the redesigned workspace without changing values', async ({page}) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await open(page);
  await page.waitForSelector('#gp option', {state: 'attached'});
  await page.evaluate(() => {
    for (const [id, value] of [['gp', '16'], ['session', 'Qualifying']]) {
      const el = document.getElementById(id); el.value = value; el.dispatchEvent(new Event('change', {bubbles: true}));
    }
  });
  await page.locator('#loadSession').click();
  // Drivers are listed one per row in the workspace rail (as in the macOS sidebar); laps are then chosen in the sheet.
  const drivers = page.locator('#linearWorkspace #driverPills button');
  await expect(drivers.nth(4)).toBeVisible({timeout: 30000});
  expect(await drivers.nth(0).evaluate(el => el.getBoundingClientRect().left)).toBe(await drivers.nth(4).evaluate(el => el.getBoundingClientRect().left));
  await drivers.nth(0).click(); await drivers.nth(4).click();
  await page.locator('#lapWorkspaceToggle').click();
  await page.locator('#compareAllFastest').click();
  await expect(page.locator('#loadedLaps .loaded-lap-pill')).toHaveCount(2, {timeout: 30000});
  await expect(page.locator('.driver-run-card')).toHaveCount(2, {timeout: 30000});
  await expect(page.locator('.driver-run-card').first()).toContainText('1:35.130');
  await expect(page.locator('.driver-run-card').nth(1)).toContainText('1:35.666');
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({path: `test-results/linear-session-${test.info().project.name}.png`});
  await page.setViewportSize({width: 390, height: 844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({path: `test-results/linear-mobile-${test.info().project.name}.png`});
});

test('all eight performance categories work with the Linear rail and flat bars', async ({page}) => {
  test.setTimeout(90000);
  await isolate(page); await replayFixture(page);
  await page.goto('/apex/cars/pace?year=2026&scope=tracks&races=16,17,18&run=1');
  await expect(page.locator('#performanceMetricPanel')).toBeVisible({timeout: 30000});
  await expect(page.locator('#performanceMetricPanel')).not.toHaveAttribute('aria-busy', 'true', {timeout: 30000});
  for (const metric of ['pace', 'corners', 'straight', 'braking', 'pits', 'tyres', 'trend', 'results']) {
    await page.locator(`#linearWorkspace [data-sidebar-metric="${metric}"]`).click();
    await expect(page.locator(`#linearWorkspace [data-sidebar-metric="${metric}"]`)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#performanceMetricPanel')).toBeVisible();
    for (const width of [1440, 390]) {
      await page.setViewportSize({width, height: 900});
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    }
  }
  await page.setViewportSize({width: 1440, height: 900});
  await page.locator('#linearWorkspace [data-sidebar-metric="trend"]').click();
  const selected = page.locator('#performanceTrackPills .track-pill[aria-pressed="true"]').first();
  expect(await selected.evaluate(el => getComputedStyle(el).gridTemplateRows.split(' ').length), 'selected track check stays on one row').toBe(1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({path: `test-results/linear-performance-${test.info().project.name}.png`});
});
