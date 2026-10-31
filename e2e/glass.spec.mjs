import {test, expect} from '@playwright/test';
import {alpha, emulateChromiumMedia} from './helpers.mjs';

test.beforeEach(async ({page}) => { await page.goto('/apex/ui-catalog.html'); });

const userSelect = locator => locator.first().evaluate(el => { const style = getComputedStyle(el); return style.userSelect || style.webkitUserSelect; });

test('interface chrome cannot be text-selected, content can', async ({page}) => {
  for (const selector of ['[data-catalog-section="push-buttons"] button', '.category-bar [role="tab"]', '.session-analysis-tabs button',
    '.select-trigger', '[data-catalog-section="segmented-choices"] button', '.perf-sort-btn', 'summary'])
    expect(await userSelect(page.locator(selector)), selector).toBe('none');
  for (const selector of ['.performance-table td', 'input[type="search"]', '.performance-quality-status'])
    expect(await userSelect(page.locator(selector)), selector).not.toBe('none');
});

test('toolbar glass follows the pointer and lets go of it', async ({page}) => {
  const button = page.locator('#catalogSidebarToggle');
  await expect(button).toHaveAttribute('data-glass', '');
  const box = await button.boundingBox();
  await page.mouse.move(box.x + 6, box.y + 7);
  await page.mouse.move(box.x + 12, box.y + 9);
  const read = () => button.evaluate(el => ({x: parseFloat(getComputedStyle(el).getPropertyValue('--glass-x')), y: parseFloat(getComputedStyle(el).getPropertyValue('--glass-y')), image: getComputedStyle(el).backgroundImage}));
  await expect.poll(async () => Math.abs((await read()).x - 12)).toBeLessThanOrEqual(1.5);
  const hovered = await read();
  expect(Math.abs(hovered.y - 9), 'within a pixel of where the pointer is').toBeLessThanOrEqual(1.5);
  expect(hovered.image).toContain('radial-gradient');
  await page.mouse.move(box.x + box.width + 80, box.y + box.height + 80);
  await expect.poll(async () => (await read()).image).not.toContain('radial-gradient');
  expect(Number.isNaN((await read()).x), 'the pointer position is cleared').toBe(true);
});

test('pressing glass gives a small scale that springs back, and reduced motion removes it', async ({page}) => {
  const button = page.locator('#catalogSidebarToggle');
  const scale = () => button.evaluate(el => { const t = getComputedStyle(el).transform; return t === 'none' ? 1 : Number(t.match(/matrix\(([^,]+)/)[1]); });
  const box = await button.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect.poll(scale).toBeCloseTo(0.97, 2);
  await page.mouse.up();
  await expect.poll(scale).toBeCloseTo(1, 2);
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.mouse.down();
  await page.waitForTimeout(250);
  expect(await scale()).toBe(1);
  await page.mouse.up();
});

test('reduced transparency and increased contrast remove the highlight', async ({page, browserName}) => {
  test.skip(browserName !== 'chromium', 'prefers-reduced-transparency can only be emulated through the Chromium protocol');
  const button = page.locator('#catalogSidebarToggle'), box = await button.boundingBox();
  await emulateChromiumMedia(page, [{name: 'prefers-reduced-transparency', value: 'reduce'}]);
  await page.mouse.move(box.x + 8, box.y + 8);
  await page.mouse.move(box.x + 12, box.y + 9);
  await expect.poll(() => button.evaluate(el => getComputedStyle(el).backgroundImage)).toBe('none');
  await emulateChromiumMedia(page, [{name: 'prefers-reduced-transparency', value: 'no-preference'}]);
  await page.emulateMedia({contrast: 'more'});
  await page.mouse.move(box.x + 10, box.y + 8);
  await expect.poll(() => button.evaluate(el => getComputedStyle(el).backgroundImage)).toBe('none');
});

test('a sheet fades and drops in, its scrim fades, and both reverse on close', async ({page}) => {
  const dialog = page.locator('#catalogDialog');
  const style = () => dialog.evaluate(el => ({opacity: Number(getComputedStyle(el).opacity), transition: getComputedStyle(el).transitionDuration, backdrop: Number(getComputedStyle(el, '::backdrop').opacity)}));
  await page.locator('#catalogDialogButton').click();
  await expect.poll(async () => (await style()).opacity).toBe(1);
  expect((await style()).transition).toContain('0.32s');
  await expect.poll(async () => (await style()).backdrop).toBe(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('a popover opens from its control with a small scale', async ({page}) => {
  const popover = page.locator('#catalogPopover');
  await page.locator('#catalogPopoverButton').click();
  await expect(popover).toBeVisible();
  const origin = await popover.evaluate(el => getComputedStyle(el).transformOrigin);
  const box = await popover.boundingBox();
  const [x, y] = origin.split(' ').map(parseFloat);
  expect(x, 'scales from the left edge').toBeLessThan(1);
  expect(y, 'scales from the top edge').toBeLessThan(1);
  expect(box.width).toBeGreaterThan(100);
  expect(alpha(await popover.evaluate(el => getComputedStyle(el).backgroundColor))).toBeLessThan(1);
});

test('the glass effect can be switched off by the person, and stays off after a reload', async ({page}) => {
  const button = page.locator('#catalogSidebarToggle');
  const image = () => button.evaluate(el => getComputedStyle(el).backgroundImage);
  await page.evaluate(() => window.ApexGlass.setIntensity('off'));
  let box = await button.boundingBox();
  await page.mouse.move(box.x + 6, box.y + 7); await page.mouse.move(box.x + 12, box.y + 9);
  expect(await image(), 'no highlight while off').not.toContain('radial-gradient');
  await page.mouse.down();
  expect(await button.evaluate(el => getComputedStyle(el).transform), 'no press response while off').toBe('none');
  await page.mouse.up();
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-glass-off')), 'remembered').toBe(true);
  await page.evaluate(() => window.ApexGlass.setIntensity('full'));
  box = await button.boundingBox();
  await page.mouse.move(box.x + 6, box.y + 7); await page.mouse.move(box.x + 12, box.y + 9);
  await expect.poll(image).toContain('radial-gradient');
});
