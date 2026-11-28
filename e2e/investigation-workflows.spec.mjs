import {test, expect} from '@playwright/test';
import {isolate, replayFixture} from './helpers.mjs';

test('Season result facts keep consistent insets without clipping on narrow screens', async ({page}, info) => {
  await page.goto('/apex/season/results?year=2026');
  const facts = page.locator('.season-numbers-card .season-numbers');
  await expect(facts.locator(':scope > div')).toHaveCount(7);
  for (const width of [1440,1024,390]) {
    await page.setViewportSize({width,height:900});
    const layout = await facts.evaluate(node => {
      const tiles = [...node.children];
      return {pad:tiles.map(tile=>getComputedStyle(tile).paddingInlineStart),
        fits:tiles.every(tile=>{
          const value=tile.querySelector('b');
          return value.scrollWidth<=value.clientWidth+1;
        })};
    });
    expect(new Set(layout.pad)).toEqual(new Set(['12px']));
    expect(layout.fits).toBe(true);
    await facts.screenshot({path:info.outputPath(`result-facts-${width}.png`)});
  }
});

test('historical standings follow the selected round for drivers and constructors', async ({page}) => {
  await page.goto('/apex/season/standings?year=2026');
  const picker = page.locator('select[aria-label="Standings after Grand Prix"]');
  const first = await picker.locator('option').last().getAttribute('value');
  const points = page.locator('.season-standings tbody tr').first().locator('td.season-points');
  const latest = await points.innerText();
  await picker.selectOption(first, {force: true});
  await expect(points).not.toHaveText(latest);
  await page.getByRole('button', {name: 'Constructors', exact: true}).click();
  await expect(picker).toHaveValue(first);
  await expect(page).toHaveURL(url => url.searchParams.get('round') === first && url.searchParams.get('part') === 'constructors');
  await expect(page.locator('.season-title-fight')).toHaveCount(0);
  await page.reload();
  await expect(picker).toHaveValue(first);
  await expect(page.getByRole('button', {name:'Constructors', exact:true})).toHaveAttribute('aria-pressed','true');
});

test('Car performance race search preserves selected races across filters', async ({page}, info) => {
  await isolate(page);
  await page.goto('/apex/cars?year=2026&scope=tracks');
  const tray = page.getByRole('region', {name:'Grand Prix selection'});
  const search = tray.getByRole('searchbox', {name:'Find a Grand Prix'});
  const pills = tray.locator('.track-pill:visible');
  await search.fill('r1');
  await expect(pills).toHaveCount(1);
  await expect(pills.first()).toContainText('Australian');
  await pills.first().click();
  await search.fill('China Shanghai');
  await expect(pills).toHaveCount(1);
  await pills.first().click();
  await expect(tray.getByText('2 selected')).toBeVisible();
  await search.clear();
  const selected = tray.getByRole('button', {name:'Selected only'});
  await selected.click();
  await expect(pills).toHaveCount(2);
  await expect(selected).toHaveAttribute('aria-pressed','true');
  await tray.screenshot({path:info.outputPath('filtered-races.png')});
  await pills.first().click();
  await expect(pills).toHaveCount(1);
  await expect(pills.first()).toBeFocused();
  await search.fill('no-match');
  await expect(tray.getByRole('status')).toHaveText('No races match this filter.');
  await expect(tray.getByText('1 selected')).toBeVisible();
});

test('Head-to-head shows discrete margins and keeps focus when changing sessions', async ({page}, info) => {
  await page.goto('/apex/season/h2h?year=2026&a=antonelli&b=russell&part=points');
  const chart = page.locator('.season-battle-log');
  await expect(chart.locator('.battle-bar').first()).toBeVisible();
  const card = chart.locator('..');
  const qualifying = card.getByRole('button', {name:'Qualifying', exact:true});
  await qualifying.click();
  await expect(qualifying).toBeFocused();
  await expect(qualifying).toHaveAttribute('aria-pressed','true');
  await expect(chart).toHaveAttribute('aria-label', 'Qualifying margin at each round');
  await expect(chart.locator('.battle-bar').first()).toBeVisible();
  const dataPoint = chart.locator('[data-tip*="ahead by"]').first();
  await expect(dataPoint).toHaveAttribute('data-tip', /ahead by \d+ place/);
  await card.screenshot({path:info.outputPath('teammate-margins.png')});
  await page.setViewportSize({width:390, height:900});
  await expect(chart.locator('.battle-bar').first()).toBeVisible();
  expect(await chart.evaluate(node => node.getBoundingClientRect().right <= document.documentElement.clientWidth)).toBe(true);
  await card.screenshot({path:info.outputPath('teammate-margins-phone.png')});
});

for (const width of [1440, 390]) test(`a Calendar round opens its results and standings at ${width}px`, async ({page}, info) => {
  await page.setViewportSize({width, height:900});
  await page.goto('/apex/season/schedule?year=2026&round=1');
  const round = page.locator('[data-calendar-round="1"]');
  const search = page.getByRole('searchbox', {name:'Find a Grand Prix'});
  await search.fill('r1');
  await expect(page.locator('[data-calendar-round]:visible')).toHaveCount(1);
  await search.fill('unlisted circuit');
  await expect(page.getByText('No Grand Prix matches that search.')).toBeVisible();
  await search.clear();
  await expect(round.locator('.season-round-more')).toHaveAttribute('aria-expanded','true');
  await expect(round.getByRole('heading',{name:'Race podium'})).toBeVisible();
  const circuit = round.locator('.season-round-circuit');
  const track = circuit.getByRole('link',{name:'Australian Grand Prix circuit guide'});
  await expect(track).toHaveAttribute('href',/\/season\/tracks/);
  await expect(track.locator('svg')).toBeVisible();
  expect(await circuit.evaluate(node => {
    const bounds = selector => node.querySelector(selector).getBoundingClientRect();
    const midY = rect => (rect.top + rect.bottom) / 2;
    const flag = bounds('.season-flag'), title = bounds('h3');
    const copy = bounds('.season-round-copy'), map = bounds('svg');
    // Wide screens give the outline its own leading column so outlines line up down the season; a phone keeps it after the name.
    const ordered = innerWidth > 760 ? map.right < flag.left : title.right < map.left;
    return flag.right < title.left && ordered && map.height === 40 &&
      Math.abs(midY(flag) - midY(title)) < 1 && Math.abs(midY(map) - midY(copy)) < 1;
  })).toBe(true);
  expect(await round.evaluate(node => getComputedStyle(node).display === 'grid' && node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await expect(round.getByRole('link',{name:'Analyse race'})).toHaveAttribute('href',/round=1&session=Race/);
  await round.screenshot({path:info.outputPath('calendar-expanded.png')});
  const toggle = round.getByRole('button',{name:'Results · Australian Grand Prix'});
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded','false');
  expect(await round.evaluate(node => {
    const card = node.getBoundingClientRect();
    const rows = [...node.children].filter(child => !child.hidden).map(child => child.getBoundingClientRect());
    const topSpace = Math.min(...rows.map(row => row.top)) - card.top;
    const bottomSpace = card.bottom - Math.max(...rows.map(row => row.bottom));
    return topSpace >= 12 && Math.abs(topSpace - bottomSpace) < 1;
  })).toBe(true);
  await round.screenshot({path:info.outputPath('calendar-collapsed.png')});
  await toggle.click();
  await round.getByRole('button',{name:'Standings after this race'}).click();
  await expect(page.locator('select[aria-label="Standings after Grand Prix"]')).toHaveValue('1');
  await page.goBack();
  await expect(round.getByRole('button',{name:'Full race results'})).toBeVisible();
  await round.getByRole('button',{name:'Full race results'}).click();
  await expect(page).toHaveURL(/\/results\?year=2026&round=1/);
});

test('entrant comparison copies measurements from the selected field and keeps distinct entrants', async ({page}, info) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  await isolate(page); await replayFixture(page);
  await page.goto('/apex/cars?year=2026&scope=tracks&races=16,17,18&run=1');
  const box = page.locator('.entrant-comparison');
  await expect(box).toBeVisible();
  const coverage = page.locator('.performance-round-coverage');
  await expect(coverage).toBeHidden();
  await page.locator('#explanationsToggle').click();
  await coverage.locator('summary').click();
  await expect(coverage.locator('li')).toHaveCount(3);
  await expect(coverage.locator('li').filter({hasText:'Included'}).first()).toBeVisible();
  await expect(async () => {
    await coverage.screenshot({path:info.outputPath('measure-coverage.png'),timeout:1500});
  }).toPass({timeout:5000});
  await coverage.locator('summary').click();
  await box.locator('summary').click();
  const picks = box.locator('select');
  const second = await picks.nth(1).inputValue();
  await picks.first().selectOption(second, {force: true});
  await expect(picks.nth(1)).not.toHaveValue(second);
  await expect(box.locator('thead th').nth(1)).toHaveText(second);
  const firstChart = page.locator('.performance-chart-card').filter({has: page.locator('.performance-bar-row')}).first();
  await expect(firstChart.locator('.performance-quality-status')).toHaveText(/\d+ shared GPs/);
  await expect(firstChart.locator('.performance-bar-row').first()).toHaveAttribute('aria-label', /shared GP.*provisional/);
  const fieldRow = firstChart.locator('.performance-bar-row').filter({has: page.getByText(second, {exact:true})}).first();
  await expect(box.locator('tbody tr').first().locator('td').first()).toHaveText(await fieldRow.locator('.performance-bar-val').innerText());
  await box.scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath('entrant-comparison.png')});
  await page.setViewportSize({width:390,height:900});
  const profile = page.getByRole('region', {name:'Car strengths and weaknesses'});
  await expect(profile.getByRole('cell', {name:/Qualifying: rank \d+ of \d+/}).first()).toBeVisible();
  expect(await profile.getByRole('rowheader').first().evaluate(node => getComputedStyle(node).position)).toBe('sticky');
  await profile.screenshot({path:info.outputPath('team-profile-phone.png')});
});

test.describe('phone investigation', () => {
  test.use({viewport:{width:390, height:844}});
  test('inspect tyre laps and follow a development round on a phone', async ({page}, info) => {
    await isolate(page); await replayFixture(page);
    await page.goto('/apex/cars/tyres?year=2026&scope=tracks&races=16,17,18&run=1');
    await page.getByRole('button', {name:'Inspect a stint'}).click();
    const plot = page.locator('.performance-tyre-stint-plot');
    await expect(plot).toBeVisible();
    const sensitivity = page.getByRole('region', {name:'Fuel sensitivity'});
    await expect(sensitivity.getByRole('columnheader')).toHaveText(['Fuel assumption', 'Slope (s/lap)']);
    await expect(sensitivity.locator('tbody td:first-child')).toHaveText(['Observed', '+0.03 s/lap fuel gain', '+0.06 s/lap fuel gain', '+0.09 s/lap fuel gain']);
    await sensitivity.screenshot({path:info.outputPath('fuel-sensitivity-phone.png')});
    await plot.locator('summary').click();
    await expect(plot.locator('tbody tr').first()).toBeVisible();
    await plot.scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath('stint-phone.png')});
    const measurement = page.locator('.car-category-picker');
    await expect(measurement).toBeVisible();
    await measurement.locator('select').selectOption('trend', {force:true});
    const round = page.locator('[data-trend-round]');
    await round.selectOption('17', {force:true});
    await expect(page.getByRole('heading', {name:'Round 17 qualifying gaps'})).toBeVisible();
    const link = page.getByRole('link', {name:'Open qualifying laps'});
    await expect(link).toHaveAttribute('href', /round=17/);
    await expect(page.getByRole('link', {name:'Season upgrade declarations'})).toHaveAttribute('href', /season\/upgrades\?year=2026/);
    await link.click();
    await expect(page).toHaveURL(/session=Qualifying/);
  });
});
