import {test, expect} from '@playwright/test';
import {isolate} from './helpers.mjs';

for (const theme of ['dark', 'light']) test(`Live uses official fastest times when the lap history is incomplete (${theme})`, async ({page}, testInfo) => {
  test.setTimeout(60_000);
  await page.setViewportSize({width: theme === 'dark' ? 1440 : 390, height: 1000});
  await page.emulateMedia({reducedMotion: 'reduce'});
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.clock.install();
  await isolate(page);
  await page.addInitScript(colours => {
    localStorage.setItem('apex-theme', colours);
    window.APEX_LOCAL_MODE = true;
  }, theme);

  const source = {kind: 'live', running: true, connected: true};
  const state = {
    session: {meeting: 'Las Vegas Grand Prix', name: 'Practice 3', type: 'Practice', year: 2026},
    drivers: [
      {number: '3', code: 'VER', color: '#3671c6', position: 1, best: '1:35.675'},
      {number: '63', code: 'RUS', color: '#27f4d2', position: 2, best: '1:36.000'},
      {number: '1', code: 'NOR', color: '#ff8000', position: 3, best: '1:36.403'},
    ],
  };
  const lap = {lap: 11, time: '1:37.893', seconds: 97.893, fastest: true, push: true};
  const archive = Object.fromEntries(state.drivers.map((driver, index) => [driver.number, {
    lap: 7 + index, time: driver.best, seconds: Number(driver.best.slice(2)) + 60, fastest: true, push: true, distance: 6000,
  }]));
  let archiveAvailable = false, archiveTraceReady = false;
  const tracesRequested = new Set();
  const channels = {x: [0, 3000, 6000], t: [0, 46, 95], speed: [170, 300, 170], throttle: [100, 100, 100], brake: [0, 0, 0], gear: [4, 8, 4], rpm: [11000, 12000, 11000]};
  await page.route('**/api/live/status', route => route.fulfill({json: {source, auth: {available: true}}}));
  await page.route(/\/api\/live\/stream(?:\?|$)/, route => {
    const numbers = new URL(route.request().url()).searchParams.get('drivers')?.split(',') || [];
    const current = {length: 6000, laps: Object.fromEntries(numbers.map(number => [number, {
      lap: 30, x: [0, 900, 3000], t: [0, 14, 46], speed: [170, 300, 170], gear: [4, 8, 4],
    }]))};
    return route.fulfill({contentType: 'text/event-stream', body: `data: ${JSON.stringify({state, source, current})}\n\n`});
  });
  await page.route('**/api/live/laps', route => route.fulfill({json: archiveAvailable
    ? {...Object.fromEntries(Object.entries(archive).map(([driver, record]) => [driver, [record]])), 63: [archive[63], lap]}
    : {63: [lap]}}));
  await page.route('**/api/live/lap?*', async route => {
    const query = new URL(route.request().url()).searchParams;
    const driver = query.get('driver'), number = Number(query.get('lap'));
    const record = number === lap.lap && driver === '63' ? lap : archive[driver];
    if (query.get('lap') !== 'fastest') expect(number).toBe(record.lap);
    if (!archiveAvailable && !(archiveTraceReady && driver === '3')) return route.fulfill({status: 404, json: {detail: 'Telemetry is unavailable'}});
    tracesRequested.add(driver);
    await route.fulfill({json: {...record, ...channels, driver, t: [0, 46, record.seconds]}});
  });

  await page.goto('/apex/');
  await page.locator('#liveViewButton').click();
  const replay = page.getByRole('button', {name: 'Replay', exact: true});
  const replaySettings = page.getByRole('group', {name: 'Replay settings', includeHidden: true});
  await expect(replaySettings).toBeHidden();
  await replay.click();
  await expect(replaySettings).toBeVisible();
  await replay.click();
  await expect(replaySettings).toBeHidden();
  const tower = page.getByRole('region', {name: 'Timing tower'});
  await expect(tower.locator('tr[data-number="3"]')).toContainText('1:35.675');
  await page.getByRole('button', {name: 'Completed laps', exact: true}).click();
  const compare = page.getByRole('region', {name: 'Compare completed laps'});
  const drivers = compare.getByRole('group', {name: 'Drivers to compare'});
  const compareFastest = compare.getByRole('button', {name: 'Compare selected fastest laps'});
  await expect(drivers.getByRole('button')).toHaveCount(3);
  await expect(drivers.locator('button[aria-pressed="true"]')).toHaveCount(0);
  await expect(compare.getByRole('listitem')).toHaveCount(0);
  await expect(compareFastest).toBeDisabled();
  for (const driver of ['VER', 'RUS', 'NOR']) await drivers.getByRole('button', {name: new RegExp(driver)}).click();
  await expect(compare.getByRole('listitem')).toHaveCount(0);
  await compareFastest.click();
  await expect(compare.getByRole('listitem')).toHaveCount(3);
  await expect(compare.getByRole('list')).toContainText('NORTime only1:36.403');
  await drivers.getByRole('button', {name: /NOR/}).click();
  await compareFastest.click();
  await expect(compare.getByRole('listitem')).toHaveCount(2);
  await expect(compare.getByRole('list', {name: 'Laps being compared'})).toContainText('VERTime only1:35.675');
  await expect(compare.getByRole('list', {name: 'Laps being compared'})).toContainText('RUSTime only1:36.000');
  await expect(compare.getByRole('table')).toContainText('+0.325');
  await expect(compare.getByRole('status')).toContainText('Waiting for telemetry for VER, RUS.');
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

  await expect(compare.getByRole('status')).toContainText('Apex will retry automatically.');
  archiveTraceReady = true;
  await page.clock.fastForward(16_000);
  await expect(compare.getByRole('button', {name: /Change lap 1.*VER L7/})).toBeVisible();
  const charts = compare.frameLocator('iframe[title="Completed lap telemetry charts"]');
  await expect(charts.getByRole('heading', {name: 'Speed trace km/h'})).toBeVisible();

  archiveAvailable = true;
  await expect(compare.getByRole('button', {name: /Change lap 1.*VER L7/})).toBeVisible({timeout: 8000});
  await expect.poll(() => [...tracesRequested].sort()).toEqual(['1', '3', '63']);
  await expect(charts.locator('canvas[data-chart="Timing delta"]')).toBeVisible();
  await compare.getByRole('button', {name: 'Set NOR as reference'}).click();
  await expect(charts.locator('#traceDriverToggles b').first()).toHaveText('NOR');
  await charts.getByRole('button', {name: 'Zoom in', exact: true}).click();
  await expect(charts.locator('#traceZoomReadout')).toHaveText('1.35–4.65 KM');
  await charts.getByText('Inspect telemetry values', {exact: true}).click();
  await charts.getByRole('slider', {name: 'Lap distance'}).press('End');
  await expect(charts.getByRole('slider', {name: 'Lap distance'})).toHaveAttribute('aria-valuetext', '6.000 km');
  await expect(charts.getByRole('table', {name: 'Values at selected lap distance'})).toContainText('NOR L9 (reference)');
  const verTrace = charts.locator('#traceDriverToggles input[data-trace-key="VER:7"]');
  await verTrace.press('Space');
  await expect(verTrace).not.toBeChecked();
  await expect(charts.getByRole('table', {name: 'Values at selected lap distance'})).not.toContainText('VER L7');

  await charts.getByRole('button', {name: 'Expand charts'}).click();
  await expect(charts.getByRole('dialog', {name: 'Expanded lap telemetry'})).toBeVisible();
  await charts.getByRole('button', {name: 'Close view'}).press('Escape');
  await expect(charts.getByRole('dialog')).toHaveCount(0);
  await expect(charts.locator('#traceZoomReadout')).toHaveText('1.35–4.65 KM');
  await expect.poll(() => charts.locator('.speed-chart').evaluate(chart => {
    const {left, right} = chart.getBoundingClientRect();
    return left >= 0 && right <= window.innerWidth + 1;
  })).toBe(true);
  if (!process.env.CI && testInfo.project.name === 'chromium') {
    await charts.locator('.speed-chart').screenshot({path: testInfo.outputPath('speed.png')});
  }
  await page.getByRole('button', {name: 'Current telemetry'}).press('Enter');
  const currentDrivers = page.getByRole('group', {name: 'Current telemetry drivers'});
  await expect(currentDrivers.locator('button[aria-pressed="true"]')).toHaveCount(0);
  for (const driver of ['VER', 'RUS', 'NOR']) {
    const button = currentDrivers.getByRole('button', {name: driver});
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(currentDrivers.locator('button[aria-pressed="true"]')).toHaveCount(3);
  const current = page.frameLocator('iframe[title="Current lap telemetry charts"]');
  await expect(current.locator('canvas[data-chart="Gear"]')).toBeVisible();
  await expect(current.locator('#alignmentCorrectionToggle')).toBeDisabled();
  await expect(current.locator('#traceZoomReadout')).toHaveText('0.00–6.00 KM');
  await current.getByText('Inspect telemetry values', {exact: true}).click();
  await current.getByRole('slider', {name: 'Lap distance'}).press('End');
  await expect(current.getByRole('row', {name: /^VER L30/}).getByRole('cell').first()).toHaveText('—');
  await expect(pageErrors.filter(message => !message.startsWith('ResizeObserver loop'))).toEqual([]);

  await page.getByRole('button', {name: 'Completed laps', exact: true}).click();
  await page.route('**/assets/data/events/2026.json', route => route.fulfill({json: [
    {round: 21, name: 'Las Vegas Grand Prix', date: '2026-11-21', sessions: ['Practice 3']},
  ]}));
  await compare.getByRole('button', {name: 'Open in Session analysis'}).click();
  await page.waitForURL(url => url.pathname.endsWith('/session') &&
    url.searchParams.get('round') === '21' && url.searchParams.get('session') === 'Practice 3' &&
    url.searchParams.get('laps') === 'NOR.9,VER.7,RUS.11');
});
