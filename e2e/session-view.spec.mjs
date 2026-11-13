import {test, expect} from '@playwright/test';
import {isolate, replayFixture} from './helpers.mjs';

test('overview chart values are available on keyboard focus and dismiss with Escape', async ({page}) => {
  await open(page);
  const point = page.locator('#sessionOverview svg[data-hover] .point').first();
  await expect(point).toBeVisible(); await point.focus();
  const tip = page.locator('.overview-tip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText(await point.getAttribute('data-code'));
  await point.press('Escape'); await expect(tip).toBeHidden();
});

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
  // Laps are chosen in the lap sheet (Linear look); close it once both fastest laps are in.
  await page.locator('#lapWorkspaceToggle').click();
  await page.click('#compareAllFastest');
  await expect(page.locator('.driver-run-card')).toHaveCount(2, {timeout: 30_000});
  await page.keyboard.press('Escape');
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

test('drivers carry their photo on the team colour, or a team-colour chip with their car number, in both appearances', async ({page}) => {
  await open(page);
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    const faces = await page.evaluate(() => [...document.querySelectorAll('#driverPills img.driver-face')].filter(el => el.offsetParent).map(el => ({
      src: el.getAttribute('src'), width: el.getBoundingClientRect().width, background: getComputedStyle(el).backgroundColor})));
    for (const face of faces) {
      expect(face.src, `${theme}: a driver photo`).toMatch(/^assets\/drivers\/[a-z_]+\.webp$/);
      expect(face.width).toBeGreaterThan(0); expect(face.background, 'on the team colour').not.toBe('rgba(0, 0, 0, 0)');
    }
    const chips = await page.evaluate(() => [...document.querySelectorAll('#driverPills .team-mark')].filter(el => el.offsetParent).map(el => {
      const after = getComputedStyle(el, '::after');
      return {team: el.dataset.teamMark, number: after.content.replace(/"/g, ''), size: parseFloat(after.fontSize), width: el.getBoundingClientRect().width,
        background: getComputedStyle(el).backgroundColor, ink: after.color, images: el.querySelectorAll('img').length, text: el.textContent};
    }));
    expect(chips.length + faces.length, `${theme}: driver chips or photos`).toBeGreaterThan(4);
    for (const chip of chips) {
      expect(chip.number, `${theme} ${chip.team} shows its car number`).toMatch(/^\d{1,3}$/);
      expect(chip.width).toBeGreaterThan(0); expect(chip.size).toBeGreaterThan(4); expect(chip.images).toBe(0);
      expect(chip.text, 'the number is not part of the text').toBe('');
      expect(chip.background).not.toBe(chip.ink);
    }
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
    // A transition on a closed sheet never runs, so the wait is capped.
    await page.evaluate(() => Promise.race([new Promise(done => setTimeout(done, 1500)),
      Promise.all(document.getAnimations().filter(animation => animation instanceof CSSTransition).map(animation => animation.finished.catch(() => {})))]));
    await page.waitForTimeout(350);
    expect(await contrast('#driverPills .driver-pill.selected .driver-pill-position'), `${theme}: chosen driver row`).toBeGreaterThanOrEqual(4.5);
    // Compare fastest lives in the lap sheet: judge it where it is seen, with the sheet open.
    await page.locator('#lapWorkspaceToggle').click();
    await expect(page.locator('#compareAllFastest')).toBeVisible();
    await page.waitForTimeout(350);
    expect(await contrast('#compareAllFastest'), `${theme}: Compare fastest, on`).toBeGreaterThanOrEqual(3);
    await page.keyboard.press('Escape');
  }
});

test('the toolbar icons are named, and the switches say what they do', async ({page}) => {
  await open(page);
  for (const id of ['explanationsToggle', 'themeToggle']) {
    const button = page.locator('#' + id);
    expect((await button.boundingBox()).width, id + ' is icon sized').toBeLessThanOrEqual(36);
    expect(await button.getAttribute('title'), id + ' has a tooltip').toBeTruthy();
    expect((await button.evaluate(el => el.getAttribute('aria-label') || el.textContent)).trim(), id + ' has a name').not.toBe('');
  }
});

test('every scrolling area has the same scrollbar, in both appearances', async ({page, browserName}) => {
  await open(page);
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    const styles = await page.evaluate(() => {
      const found = new Map();
      for (const el of document.querySelectorAll('html, body, body *')) {
        const style = getComputedStyle(el);
        if (el.tagName !== 'HTML' && !/(auto|scroll)/.test(style.overflowX + style.overflowY)) continue;
        if (el.id === 'linearWorkspace') continue;   // the rail hides its scrollbar on purpose; it scrolls by wheel and touch
        const key = `${style.scrollbarWidth} ${style.scrollbarColor}`;
        found.set(key, [...(found.get(key) || []), el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')]);
      }
      return Object.fromEntries([...found].map(([key, names]) => [key, [...new Set(names)].slice(0, 6)]));
    });
    expect(Object.keys(styles), `${theme}: scrollbar styles in use ${JSON.stringify(styles)}`).toHaveLength(1);
    // Headless Firefox in CI computes scrollbar-width as none on every element, while still applying our thumb colour; the stylesheets
    // never set none (test-ui.mjs), so there only the uniformity and the colour are checked.
    expect(Object.keys(styles)[0], theme).toMatch(browserName === 'firefox' ? /^(thin|none) / : /^thin /);
  }
});
