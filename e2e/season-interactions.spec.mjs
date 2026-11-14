import {test, expect} from '@playwright/test';

for (const [tab, first, second] of [['standings', 'Drivers', 'Constructors'], ['units', 'Drivers', 'Teams']]) {
  test(`${tab} segmented choices retain focus and selected feedback after repaint`, async ({page}) => {
    await page.goto(`/apex/season/${tab}?year=2026`);
    // The page's own controls (the Season pills above them also name a "Drivers" page).
    const root = page.locator('#seasonHub .season-body');
    const a = root.getByRole('button', {name: first, exact: true}), b = root.getByRole('button', {name: second, exact: true});
    await expect(a).toHaveAttribute('aria-pressed', 'true');
    await a.focus(); await a.press('ArrowRight');
    await expect(b).toHaveAttribute('aria-pressed', 'true'); await expect(b).toBeFocused();
    await b.press('ArrowLeft');
    await expect(a).toHaveAttribute('aria-pressed', 'true'); await expect(a).toBeFocused();
  });
}

test('driver selection returns keyboard focus to the rebuilt selector', async ({page}) => {
  await page.goto('/apex/season/drivers?year=2026');
  const field = page.locator('#seasonHub select[aria-label="Driver"]');
  const trigger = field.locator('..').locator('.select-trigger');
  await expect(trigger).toBeVisible();
  const before = await field.inputValue();
  await trigger.focus(); await trigger.press('ArrowDown');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(field).not.toHaveValue(before);
  await expect(field.locator('..').locator('.select-trigger')).toBeFocused();
});
