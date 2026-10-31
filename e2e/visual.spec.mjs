import {test, expect} from '@playwright/test';
import {SECTIONS, isolate, emulateChromiumMedia} from './helpers.mjs';

// Screenshot baselines. They are per operating system and per browser (see snapshotPathTemplate), so they are
// run on demand rather than in CI:  npm run test:visual   and   npm run test:visual -- --update-snapshots
const THEMES = ['dark', 'light'];
const setTheme = (page, theme) => page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);

test.describe('catalogue @visual', () => {
  for (const theme of THEMES) {
    test(`every section, ${theme}`, async ({page}) => {
      await page.goto('/apex/ui-catalog.html');
      await setTheme(page, theme);
      for (const slug of SECTIONS.filter(slug => slug !== 'verification')) {
        await expect(page.locator(`[data-catalog-section="${slug}"]`)).toHaveScreenshot(`${theme}-${slug}.png`);
      }
    });
  }

  test('materials with reduced transparency and increased contrast', async ({page, browserName}) => {
    test.skip(browserName !== 'chromium', 'emulated through the Chromium protocol');
    await page.goto('/apex/ui-catalog.html');
    const materials = page.locator('[data-catalog-section="materials"]');
    await emulateChromiumMedia(page, [{name: 'prefers-reduced-transparency', value: 'reduce'}]);
    await expect(materials).toHaveScreenshot('dark-materials-reduced-transparency.png');
    await emulateChromiumMedia(page, [{name: 'prefers-reduced-transparency', value: 'no-preference'}]);
    await page.emulateMedia({contrast: 'more'});
    await expect(materials).toHaveScreenshot('dark-materials-increased-contrast.png');
  });

  test('touch target sizes', async ({page}) => {
    await page.goto('/apex/ui-catalog.html');
    await page.locator('#catalogDensity').click();
    await expect(page.locator('[data-catalog-section="push-buttons"]')).toHaveScreenshot('dark-push-buttons-touch.png');
  });
});

test.describe('application shell @visual', () => {
  const sizes = [{name: 'wide', width: 1440, height: 900}, {name: 'laptop', width: 1024, height: 768}, {name: 'phone', width: 390, height: 844}];
  for (const size of sizes) for (const theme of THEMES) {
    test(`${size.name}, ${theme}`, async ({page}) => {
      await page.setViewportSize({width: size.width, height: size.height});
      await isolate(page);
      await page.addInitScript(value => localStorage.setItem('apex-theme', value), theme);
      await page.goto('/apex/');
      await expect(page.locator('#gp option')).toHaveCount(3);
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveScreenshot(`${size.name}-${theme}.png`, {mask: [page.locator('.local-compute-status')]});
    });
  }
});
