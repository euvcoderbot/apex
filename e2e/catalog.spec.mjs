import {test, expect} from '@playwright/test';
import {SECTIONS, alpha, emulateChromiumMedia} from './helpers.mjs';

test.beforeEach(async ({page}) => { await page.goto('/apex/ui-catalog.html'); });

test('every catalogue section renders and no control lacks a design-system owner', async ({page}) => {
  for (const slug of SECTIONS) await expect(page.locator(`[data-catalog-section="${slug}"]`), slug).toHaveCount(1);
  await expect(page.locator('#catalogAudit')).toHaveText(/^\d+ control families · 0 unowned controls$/);
  const kinds = await page.evaluate(() => Object.keys(window.ApexUI.audit().counts));
  for (const kind of ['push', 'primary', 'segment', 'tab', 'popup', 'menu-item', 'list-row', 'choice', 'sort', 'disclosure', 'checkbox', 'field'])
    expect(kinds, kind).toContain(kind);
});

test('category tabs move with the arrow keys and skip disabled tabs', async ({page}) => {
  const tabs = page.locator('.category-bar [role="tab"]');
  await tabs.nth(0).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(tabs.nth(0), 'the disabled tab is skipped, so it wraps').toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
});

test('the pop-up menu is operable from the keyboard and gives focus back', async ({page}) => {
  const trigger = page.locator('[aria-controls="catalogMenu"]'), menu = page.locator('#catalogMenu');
  await expect(menu).toBeVisible();
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  await expect(menu.locator('[role="option"]').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.locator('[role="option"]').nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('the sheet is modal and closes with Escape', async ({page}) => {
  await page.locator('#catalogDialogButton').click();
  const dialog = page.locator('#catalogDialog');
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(el => el.matches(':modal'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('the popover opens beside its control and closes with Escape', async ({page}) => {
  const button = page.locator('#catalogPopoverButton'), popover = page.locator('#catalogPopover');
  await button.click();
  await expect(popover).toBeVisible();
  const [b, p] = await Promise.all([button.boundingBox(), popover.boundingBox()]);
  expect(Math.abs(p.x - b.x), 'aligned with the trigger').toBeLessThan(2);
  expect(p.y, 'below the trigger').toBeGreaterThanOrEqual(b.y + b.height);
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
});

test('a segmented control has one thumb that moves to the chosen segment', async ({page}) => {
  const group = page.locator('[aria-label="Catalogue subject"]');
  const read = () => group.evaluate(el => ({x: getComputedStyle(el).getPropertyValue('--ui-thumb-x').trim(), thumb: el.dataset.uiThumb}));
  const before = await read();
  await group.getByRole('button', {name: 'Drivers'}).click();
  await expect.poll(async () => (await read()).x).not.toBe(before.x);
  expect((await read()).thumb).toBeTruthy();
  await group.getByRole('button', {name: 'Teams'}).click();
  await expect.poll(async () => (await read()).x, {message: 'reverses to where it started'}).toBe(before.x);
});

test.describe('accessibility settings', () => {
  test('reduced motion removes the thumb slide and the transient animations', async ({page}) => {
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.reload();
    const durations = await page.evaluate(() => {
      const group = document.querySelector('[aria-label="Catalogue subject"]');
      return [getComputedStyle(group, '::before').transitionDuration, getComputedStyle(document.querySelector('button')).transitionDuration,
        getComputedStyle(document.querySelector('.select-menu')).animationDuration];
    });
    for (const value of durations) expect(value.split(',').every(part => parseFloat(part) <= 0.001), `${value} (reduced motion leaves only an imperceptible duration)`).toBe(true);
  });

  test('materials are translucent by default and opaque with reduced transparency or increased contrast', async ({page, browserName}) => {
    test.skip(browserName !== 'chromium', 'prefers-reduced-transparency can only be emulated through the Chromium protocol');
    const read = () => page.locator('[data-catalog-section="materials"] .tooltip').evaluate(el => {
      const style = getComputedStyle(el);
      return {background: style.backgroundColor, filter: style.backdropFilter || style.webkitBackdropFilter};
    });
    const normal = await read();
    expect(normal.filter).not.toBe('none');
    expect(alpha(normal.background)).toBeLessThan(1);
    await emulateChromiumMedia(page, [{name: 'prefers-reduced-transparency', value: 'reduce'}]);
    const reduced = await read();
    expect(reduced.filter).toBe('none');
    expect(alpha(reduced.background)).toBe(1);
    await emulateChromiumMedia(page, [{name: 'prefers-reduced-transparency', value: 'no-preference'}]);
    await page.emulateMedia({contrast: 'more'});
    const contrast = await read();
    expect(contrast.filter).toBe('none');
    expect(alpha(contrast.background)).toBe(1);
  });

  test('keyboard focus is visible on a push button', async ({page}) => {
    const first = page.locator('[data-catalog-section="push-buttons"] button').first();
    await first.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(first).toBeFocused();
    const ring = await first.evaluate(el => {
      const style = getComputedStyle(el);
      return {width: parseFloat(style.outlineWidth), shadow: style.boxShadow};
    });
    expect(ring.width > 0 || ring.shadow !== 'none').toBe(true);
  });
});
