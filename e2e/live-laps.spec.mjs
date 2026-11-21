import {test, expect} from '@playwright/test';
import {isolate} from './helpers.mjs';

for (const theme of ['dark', 'light']) test(`Live uses official fastest times when the lap history is incomplete (${theme})`, async ({page}) => {
  await page.setViewportSize({width: theme === 'dark' ? 1440 : 390, height: 1000});
  await isolate(page);
  await page.addInitScript(colours => {
    localStorage.setItem('apex-theme', colours);
    window.APEX_LOCAL_MODE = true;
  }, theme);

  const source = {kind: 'live', running: true, connected: true};
  const state = {
    session: {meeting: 'Las Vegas Grand Prix', name: 'Practice 3', type: 'Practice'},
    drivers: [
      {number: '3', code: 'VER', position: 1, best: '1:35.675'},
      {number: '63', code: 'RUS', position: 2, best: '1:36.000'},
      {number: '1', code: 'NOR', position: 3, best: '1:36.403'},
    ],
  };
  const lap = {lap: 11, time: '1:37.893', seconds: 97.893, fastest: true, push: true};
  const archive = Object.fromEntries(state.drivers.map((driver, index) => [driver.number, {
    lap: 7 + index, time: driver.best, seconds: Number(driver.best.slice(2)) + 60, fastest: true, push: true, distance: 6000,
  }]));
  let archiveAvailable = false;
  const tracesRequested = new Set();
  await page.route('**/api/live/status', route => route.fulfill({json: {source, auth: {available: true}}}));
  await page.route('**/api/live/stream', route => route.fulfill({
    contentType: 'text/event-stream', body: `data: ${JSON.stringify({state, source})}\n\n`,
  }));
  await page.route('**/api/live/laps', route => route.fulfill({json: archiveAvailable
    ? {...Object.fromEntries(Object.entries(archive).map(([driver, record]) => [driver, [record]])), 63: [archive[63], lap]}
    : {63: [lap]}}));
  await page.route('**/api/live/lap?*', async route => {
    const query = new URL(route.request().url()).searchParams;
    const driver = query.get('driver'), number = Number(query.get('lap'));
    const record = number === lap.lap && driver === '63' ? lap : archive[driver];
    expect(number).toBe(record.lap);
    if (!archiveAvailable) return route.fulfill({status: 404, json: {detail: 'Telemetry is unavailable'}});
    tracesRequested.add(driver);
    await route.fulfill({json: {...record, driver, x: [0, 3000, 6000], t: [0, 46, record.seconds],
      speed: [170, 300, 170], throttle: [100, 100, 100], brake: [0, 0, 0], gear: [4, 8, 4]}});
  });

  await page.goto('/apex/');
  await page.locator('#liveViewButton').click();
  const tower = page.getByRole('region', {name: 'Timing tower'});
  await expect(tower.locator('tr[data-number="3"]')).toContainText('1:35.675');
  await page.getByRole('button', {name: 'Completed laps', exact: true}).click();
  await page.getByRole('button', {name: 'Fastest 2', exact: true}).click();

  const compare = page.getByRole('region', {name: 'Compare completed laps'});
  await expect(compare.getByRole('list', {name: 'Laps being compared'})).toContainText('VERTime only1:35.675');
  await expect(compare.getByRole('list', {name: 'Laps being compared'})).toContainText('RUSTime only1:36.000');
  await expect(compare.getByRole('table')).toContainText('+0.325');
  await expect(compare.getByText('Telemetry is unavailable for the selected laps.')).toBeVisible();
  await compare.getByRole('button', {name: /Change lap 2/}).click();
  await expect(page.getByRole('button', {name: /Fastest lap.*1:36.000.*time only/})).toBeVisible();
  await expect(page.getByRole('button', {name: /Lap 11.*1:37.893/})).toBeVisible();
  await page.getByRole('button', {name: /Lap 11.*1:37.893/}).click();
  await expect(compare.getByRole('list', {name: 'Laps being compared'})).toContainText('RUSL111:37.893');

  await compare.getByRole('button', {name: 'Add driver or lap'}).click();
  await page.getByRole('group', {name: 'Driver', exact: true}).getByRole('button', {name: /NOR/}).click();
  await page.getByRole('button', {name: /Fastest lap.*1:36.403.*time only/}).click();
  await expect(compare.getByRole('listitem')).toHaveCount(3);
  await expect(compare.getByRole('button', {name: /Change lap 3.*NOR Time only 1:36.403/})).toBeVisible();

  await page.getByRole('button', {name: 'Timing and strategy'}).click();
  await tower.getByRole('button', {name: /1:36.403, compare NOR's best lap/}).press('Enter');
  await expect(compare.getByRole('listitem')).toHaveCount(3);
  await expect(compare.getByRole('button', {name: /Change lap 3.*NOR/})).toBeFocused();
  await expect(compare.getByRole('table')).toContainText('1:36.403');

  archiveAvailable = true;
  await expect(compare.getByRole('button', {name: /Change lap 1.*VER L7/})).toBeVisible({timeout: 8000});
  await expect.poll(() => [...tracesRequested].sort()).toEqual(['1', '3', '63']);
  await expect(compare.locator('[data-panel="delta"]')).toBeVisible();
  await compare.locator('[data-live="lapChips"]').screenshot({path: test.info().outputPath('live-laps.png')});
});
