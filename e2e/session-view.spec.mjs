import {test, expect} from '@playwright/test';
import {isolate, replayFixture} from './helpers.mjs';

// Session analysis with real numbers (Bahrain 2026 qualifying, VER against LEC on their fastest laps), replayed with no network.
async function open(page) {
  await isolate(page);
  await replayFixture(page, 'session-view.json.gz');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__cls = 0;
    try { new PerformanceObserver(list => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({type: 'layout-shift', buffered: true}); } catch { /* not supported */ }
  });
  await page.goto('/apex?year=2026');
  await page.waitForSelector('#gp option', {state: 'attached'});
  await page.evaluate(() => {
    const set = (id, value) => { const el = document.getElementById(id); el.value = value; el.dispatchEvent(new Event('change', {bubbles: true})); };
    set('gp', '16'); set('session', 'Qualifying');
  });
  await page.click('#loadSession');
  const pills = page.locator('#driverPills button');
  await expect(pills.nth(4)).toBeVisible({timeout: 30_000});
  await pills.nth(0).click(); await pills.nth(4).click();
  await page.click('#compareAllFastest');
  await expect(page.locator('.driver-run-card')).toHaveCount(2, {timeout: 30_000});
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  return errors;
}

test('two laps compared: cards, charts, no errors, nothing spills sideways', async ({page}) => {
  const errors = await open(page);
  expect(errors, 'no uncaught errors').toEqual([]);
  await expect(page.locator('.driver-run-card').first()).toContainText('1:35.130');
  await expect(page.locator('.driver-run-card').nth(1)).toContainText('1:35.666');
  expect(await page.locator('canvas').count(), 'speed, delta, throttle, brake, gear and the map').toBeGreaterThanOrEqual(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 'page scrolls sideways').toBeLessThanOrEqual(0);
  const broken = await page.evaluate(() => [...document.images].filter(img => img.offsetParent && img.complete && img.naturalWidth === 0).map(img => img.src.split('/').pop()));
  expect(broken, 'images that failed to load').toEqual([]);
});

test('layout stays put while the laps load (CLS under 0.1)', async ({page, browserName}) => {
  test.skip(browserName !== 'chromium', 'layout-shift entries exist only in Chromium');
  await open(page);
  expect(await page.evaluate(() => window.__cls)).toBeLessThan(0.1);
});

test('team marks are real marks, and the monochrome ones follow the appearance', async ({page}) => {
  await open(page);
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    const marks = await page.evaluate(() => [...document.querySelectorAll('.team-logo-official')].filter(el => el.offsetParent).map(el => {
      const shown = [...el.children].find(img => getComputedStyle(img).display !== 'none');
      return {team: el.dataset.teamMark, src: shown?.getAttribute('src').split('/').pop(), width: shown?.getBoundingClientRect().width};
    }));
    expect(marks.length, `${theme}: marks on the page`).toBeGreaterThan(0);
    for (const mark of marks) { expect(mark.src, `${theme} ${mark.team} shows an image`).toBeTruthy(); expect(mark.width).toBeGreaterThan(0); }
  }
});

test('chosen rows stay readable and every state of Compare fastest has visible text, in both appearances', async ({page}) => {
  await open(page);
  // Contrast of an element's text over what is really behind it, flattening translucent backgrounds.
  const contrast = selector => page.evaluate(selector => {
    const parse = value => { const n = value.match(/[\d.]+/g).map(Number); return value.startsWith('color(') ? [n[0] * 255, n[1] * 255, n[2] * 255, n[3] ?? 1] : [n[0], n[1], n[2], n[3] ?? 1]; };
    const canvas = document.createElement('canvas').getContext('2d', {willReadFrequently: true});
    const rgba = value => { canvas.clearRect(0, 0, 1, 1); canvas.fillStyle = value; canvas.fillRect(0, 0, 1, 1); const d = canvas.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
    const el = document.querySelector(selector), layers = [];
    for (let node = el; node; node = node.parentElement) { const c = rgba(getComputedStyle(node).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] === 1) break; }
    const base = layers.reverse().reduce((under, c) => under.map((v, i) => c[i] * c[3] + v * (1 - c[3])), [255, 255, 255]);
    const fg = rgba(getComputedStyle(el).color), text = base.map((v, i) => fg[i] * fg[3] + v * (1 - fg[3]));
    const lum = rgb => { const [r, g, b] = rgb.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
    const [a, b] = [lum(text), lum(base)].sort((x, y) => y - x);
    return (a + .05) / (b + .05);
  }, selector);
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    // Colours transition when the appearance changes; judge them once they have arrived, not part way (Firefox measured mid-transition). Only transitions are awaited: looping animations never finish.
    await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation instanceof CSSTransition).map(animation => animation.finished.catch(() => {}))));
    await page.waitForTimeout(350);
    expect(await contrast('#driverPills .driver-pill.selected .driver-pill-position'), `${theme}: chosen driver row`).toBeGreaterThanOrEqual(4.5);
    expect(await contrast('#compareAllFastest'), `${theme}: Compare fastest, on`).toBeGreaterThanOrEqual(3);
  }
});

test('the toolbar icons are named, and the switches say what they do', async ({page}) => {
  await open(page);
  for (const id of ['explanationsToggle', 'themeToggle', 'glassToggle']) {
    const button = page.locator('#' + id);
    expect((await button.boundingBox()).width, id + ' is icon sized').toBeLessThanOrEqual(36);
    expect(await button.getAttribute('title'), id + ' has a tooltip').toBeTruthy();
    expect((await button.evaluate(el => el.getAttribute('aria-label') || el.textContent)).trim(), id + ' has a name').not.toBe('');
  }
});
