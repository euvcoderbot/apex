import {defineConfig, devices} from '@playwright/test';

const port = Number(process.env.APEX_E2E_PORT||54152);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid APEX_E2E_PORT');
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  // Screenshots are rendered by the machine that takes them, so baselines are per operating system.
  snapshotPathTemplate: 'e2e/__screenshots__/{platform}/{projectName}/{testFilePath}/{arg}{ext}',
  expect: {toHaveScreenshot: {maxDiffPixels: 20, animations: 'disabled'}},
  use: {baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure'},
  webServer: {
    command: `node scripts/sync-static.mjs && node scripts/serve-static.mjs ${port}`,
    url: `http://127.0.0.1:${port}/apex/ui-catalog.html`,
    // A server from another checkout can silently test obsolete assets.
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {name: 'chromium', use: {...devices['Desktop Chrome'], viewport: {width: 1280, height: 900}}},
    {name: 'firefox', use: {...devices['Desktop Firefox'], viewport: {width: 1280, height: 900}}},
    {name: 'webkit', use: {...devices['Desktop Safari'], viewport: {width: 1280, height: 900}}},
  ],
});
