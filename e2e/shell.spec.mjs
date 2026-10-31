import {test, expect} from '@playwright/test';
import {isolate} from './helpers.mjs';

// Budgets are set just above today's numbers (hosted-like gzip, 22 files before lazy loading was 271 KB; the session view
// now needs about 154 KB). They exist to catch regressions, not to define a target.
const BUDGET = {initialScriptKB: 185, initialStyleKB: 80, idleDomNodes: 600, layoutShift: 0.02};

/** Records long tasks, layout shift and the moment of the load event from the very start of the page. */
const observe = () => {
  window.__metrics = {longTasks: [], cls: 0, lcp: null, loadAt: null};
  try { new PerformanceObserver(list => list.getEntries().forEach(entry => window.__metrics.longTasks.push(Math.round(entry.duration)))).observe({type: 'longtask', buffered: true}); } catch {}
  try { new PerformanceObserver(list => list.getEntries().forEach(entry => { if (!entry.hadRecentInput) window.__metrics.cls += entry.value; })).observe({type: 'layout-shift', buffered: true}); } catch {}
  try { new PerformanceObserver(list => { window.__metrics.lcp = Math.round(list.getEntries().at(-1).startTime); }).observe({type: 'largest-contentful-paint', buffered: true}); } catch {}
  addEventListener('load', () => { window.__metrics.loadAt = performance.now(); });
};

async function open(page, path = '/apex/') {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await isolate(page);
  await page.addInitScript(observe);
  await page.goto(path);
  await expect(page.locator('#gp option')).toHaveCount(3);
  return {errors};
}

test('the session view stays inside its download, DOM and layout budgets', async ({page}, info) => {
  const {errors} = await open(page);
  await page.waitForLoadState('networkidle');
  const report = await page.evaluate(() => {
    const kb = bytes => Math.round(bytes / 1024);
    const resources = performance.getEntriesByType('resource'), early = resources.filter(entry => entry.startTime < window.__metrics.loadAt);
    const sum = (list, pattern) => list.filter(entry => pattern.test(entry.name.split('?')[0])).reduce((n, entry) => n + entry.encodedBodySize, 0);
    return {
      scriptKB: kb(sum(early, /\.js$/)), styleKB: kb(sum(early, /\.css$/)), scriptKBAfterIdle: kb(sum(resources, /\.js$/)), filesBeforeLoad: early.length,
      ...window.__metrics, domNodes: document.querySelectorAll('*').length,
      cssRules: [...document.styleSheets].reduce((n, sheet) => { const walk = list => [...list].reduce((m, rule) => m + 1 + (rule.cssRules ? walk(rule.cssRules) : 0), 0); try { return n + walk(sheet.cssRules); } catch { return n; } }, 0),
      blurred: [...document.querySelectorAll('*')].filter(el => { const s = getComputedStyle(el); return (s.backdropFilter || s.webkitBackdropFilter || 'none') !== 'none'; }).length,
    };
  });
  await info.attach('metrics.json', {body: JSON.stringify({project: info.project.name, ...report}, null, 2), contentType: 'application/json'});
  expect(errors, 'no uncaught errors').toEqual([]);
  expect(report.scriptKB, 'script KB before the load event').toBeLessThanOrEqual(BUDGET.initialScriptKB);
  expect(report.styleKB).toBeLessThanOrEqual(BUDGET.initialStyleKB);
  expect(report.domNodes).toBeLessThanOrEqual(BUDGET.idleDomNodes);
  expect(report.cls).toBeLessThanOrEqual(BUDGET.layoutShift);
});

test('car performance is not fetched before the page has loaded', async ({page}) => {
  await open(page);
  const early = await page.evaluate(() => performance.getEntriesByType('resource')
    .filter(entry => /car-performance|react-islands/.test(entry.name) && entry.startTime < window.__metrics.loadAt).map(entry => entry.name));
  expect(early).toEqual([]);
});

test('opening Car performance loads it, shows the view and updates the route and title', async ({page}) => {
  await open(page);
  await page.getByRole('tab', {name: 'Car performance'}).click();
  await expect(page.locator('body')).toHaveClass(/performance-view/);
  await expect(page).toHaveURL(/\/apex\/cars$/);
  await expect(page).toHaveTitle(/^Pace · Car performance/);
  await page.goBack();
  await expect(page.locator('body')).not.toHaveClass(/performance-view/);
});

test('a shared car-performance address keeps its category and year while the module loads', async ({page}) => {
  await open(page, '/apex/cars/braking?year=2026');
  await expect(page.locator('body')).toHaveClass(/performance-view/);
  await expect(page).toHaveURL(/\/apex\/cars\/braking\?year=2026/);
  await expect(page).toHaveTitle(/^Braking · Car performance 2026/);
});

test('every selection control in the toolbar and sidebar is operable by keyboard', async ({page}) => {
  await open(page);
  await page.getByRole('tab', {name: 'Session analysis'}).focus();
  await page.keyboard.press('Tab');
  const reached = await page.evaluate(() => document.activeElement && (document.activeElement.dataset.analysisView || document.activeElement.tagName));
  expect(reached).toBeTruthy();
  for (const label of ['Season', 'Grand Prix', 'Session']) {
    const trigger = page.getByRole('combobox', {name: label});
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  }
});

test('toolbar controls in the real page are glass and answer the pointer', async ({page}) => {
  await open(page);
  for (const selector of ['.site-header .performance-tabs', '#themeToggle', '#windowSidebarToggle'])
    await expect(page.locator(selector), selector).toHaveAttribute('data-glass', '');
  await expect(page.locator('.local-compute-status[data-glass]'), 'the status pill is not a glass control').toHaveCount(0);
  const toggle = page.locator('#themeToggle'), box = await toggle.boundingBox();
  await page.mouse.move(box.x + 6, box.y + 6);
  await page.mouse.move(box.x + 11, box.y + 8);
  await expect.poll(() => toggle.evaluate(el => getComputedStyle(el).backgroundImage)).toContain('radial-gradient');
});

test('Car performance with no data says which sessions failed and stays usable', async ({page}) => {
  await open(page, '/apex/cars');
  await expect(page.locator('body')).toHaveClass(/performance-view/);
  await page.getByRole('button', {name: 'Tracks'}).click();
  const pills = page.locator('.track-pill');
  await expect(pills.first()).toBeVisible();
  await pills.first().click();
  await expect(pills.first()).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', {name: 'Analyse'}).click();
  const warning = page.locator('.performance-error').first();
  await expect(warning).toBeVisible({timeout: 30_000});
  await expect(warning).toContainText('Grand Prix');
  const analyse = page.getByRole('button', {name: 'Analyse'});
  await expect(analyse, 'the person can try again').toBeEnabled();
  await expect(page.locator('.track-pill').first()).toHaveAttribute('title', /Grand Prix/);
});
