import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';

const base = new URL('../assets/data/season/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', base)));
const route = '/api/season?year=2026';
const entry = index.entries[route];
const fixture = JSON.parse(gunzipSync(readFileSync(new URL(entry.file, base))));
const next = fixture.rounds.find(r => r.circuit_id === 'vegas');
for (const round of fixture.rounds) if (round.status === 'next') round.status = 'upcoming';
next.status = 'next';
next.utc_offset = -8 * 3600;
next.sun = {};
for (const session of next.sessions) {
  const day = new Date(Date.parse(session.start) + next.utc_offset * 1000).toISOString().slice(0, 10);
  next.sun[day] = {sunrise: `${day}T06:00`, sunset: `${day}T16:30`};
  session.weather = {
    temp: 15, rain: 69, wind: 13, code: 2, humidity: 50, direction: 265, gust: 22, cloud: 35, mm: 0.1,
    hours: [{at: '19:00', rain: 43}, {at: '20:00', rain: 69}],
  };
}
next.sessions[0].weather.mm = 0;
delete next.sessions[1].weather.mm;

test.beforeEach(async ({page}) => {
  await page.route('**/assets/data/season/index.json', r => r.fulfill({json: {...index, entries: {...index.entries, [route]: {...entry, saved_at: new Date().toISOString()}}}}));
  await page.route(`**/assets/data/season/${entry.file}`, r => r.fulfill({json: fixture}));
});

for (const width of [1440, 1024, 768, 390]) test.describe(`Forecast at ${width}px`, () => {
  test.use({viewport: {width, height: 1000}});
  test(`detailed session forecasts fit the panel at ${width}px`, async ({page}) => {
    await page.clock.setFixedTime(new Date(Date.parse(next.sessions[0].start) - 60_000));
    await page.addInitScript(theme => localStorage.setItem('apex-theme', theme), width === 390 ? 'light' : 'dark');
    await page.goto('/apex/');
    await expect(page.getByRole('link', {name: 'Circuit guide'})).toHaveAttribute('href', /season\/tracks.*track=Las\+Vegas\+Grand\+Prix/);
    for (const selector of ['.season-forecast-humid', '.season-forecast-cloud', '.season-forecast-light', '.season-rain-strip'])
      await expect(page.locator(selector)).toHaveCount(next.sessions.length);
    const fits = await page.locator('.season-forecast').evaluate(n => n.scrollWidth <= n.clientWidth + 1);
    expect(fits).toBe(true);
    const rows = page.locator('.season-forecast-row');
    await expect(rows.first().locator('.season-forecast-rain')).toHaveText('Rain chance69%');
    await expect(rows.first().locator('.season-forecast-amount')).toHaveText('Rainfall0.0 mm');
    await expect(rows.nth(1).locator('.season-forecast-amount')).toHaveText('Rainfall—');
    if (width === 1440 || width === 390) await page.locator('.season-weather').screenshot({path: test.info().outputPath('weather.png')});
    for (const cell of await page.locator('.season-forecast-humid').all()) await expect(cell).toBeVisible();
    if (width === 390) {
      expect(await page.locator('#linearWorkspace').evaluate(n => n.getBoundingClientRect().height)).toBeLessThan(120);
      const boxes = await page.locator('.linear-navigation button').evaluateAll(ns => ns.map(n => n.getBoundingClientRect().top));
      expect(Math.max(...boxes) - Math.min(...boxes)).toBeLessThan(1);
    }
  });
});

test('Las Vegas FP1 switches to the observed wet track as the session ends', async ({page}) => {
  await page.setViewportSize({width: 390, height: 1000});
  const fp1End = Date.parse(next.sessions[0].start) + 60 * 60_000;
  await page.clock.install({time: new Date(fp1End - 60_000)});
  await page.goto('/apex/');
  const sessions = page.locator('.season-sessions');
  const fp1 = sessions.locator('li').filter({hasText: 'Practice 1'});
  const fp2 = sessions.locator('li').filter({hasText: 'Practice 2'});
  const forecast = page.locator('.season-forecast');
  await expect(fp1).toHaveAttribute('data-state', 'running');
  await expect(fp1).not.toContainText(/rain chance|expected/);
  await expect(fp2).toContainText('69% rain chance');
  await expect(forecast.getByText('FP1', {exact: true})).toHaveCount(0);

  await page.clock.fastForward(120_000);
  await expect(fp1).toHaveAttribute('data-state', 'done');
  const observation = fp1.getByRole('link', {name: 'Observed wet track'});
  await expect(observation).toHaveAttribute('href', /^https:\/\/www\.fia\.com\//);
  await expect(fp1).not.toContainText(/rain chance|expected/);

  const fp2End = Date.parse(next.sessions[1].start) + 60 * 60_000;
  await page.clock.fastForward(fp2End - fp1End);
  await expect(fp2).toContainText('Observed weather unavailable');
  await expect(forecast.getByText('FP2', {exact: true})).toHaveCount(0);
  await expect(forecast.getByText('FP3', {exact: true})).toBeVisible();
  await sessions.screenshot({path: test.info().outputPath('observed-weather.png')});
});

for (const width of [1440, 390]) {
  test('Tracks previews the next race and prefers the latest qualifying lap at ' + width + 'px', async ({page}, testInfo) => {
    await page.setViewportSize({width, height: 1000});
    await page.addInitScript(theme => localStorage.setItem('apex-theme', theme), width === 390 ? 'light' : 'dark');
    const vegas = 'Las Vegas Grand Prix';
    const profiles = [2025, 2026].map(year => JSON.parse(readFileSync(new URL('../assets/data/track-profiles/' + year + '.json', import.meta.url))));
    const nextLap = profiles[0].tracks[vegas];
    delete profiles[1].tracks['Qatar Grand Prix'];
    delete profiles[1].tracks[vegas];
    await page.route('**/assets/data/track-profiles/2026.json', route => route.fulfill({json: profiles[1]}));
    await page.goto('/apex/season/tracks?year=2026');
    const choice = page.getByRole('group', {name: 'Track'}).locator('button[title="Las Vegas Grand Prix"]');
    const header = page.locator('.season-track-head');
    await expect(choice).toHaveAttribute('aria-pressed', 'true');
    await expect(header.getByRole('heading', {name: 'Las Vegas', exact: true})).toBeVisible();
    await expect(header).toContainText('Round 21 · Next race');
    await expect(header).toContainText('2025 qualifying lap');
    await expect(header).toContainText('2026 telemetry pending');
    if (testInfo.project.name === 'chromium' && !process.env.CI) {
      await header.screenshot({path: testInfo.outputPath('track-preview.png')});
    }
    await page.getByRole('button', {name: 'All circuits', exact: true}).click();
    await expect(page.getByRole('button', {name: /Las Vegas/})).toHaveCount(0);
    const table = page.getByRole('region', {name: 'Circuit comparison'});
    const sort = table.getByRole('button', {name: 'Sort by Gear changes'});
    await sort.focus();
    const offset = await table.evaluate(node => node.scrollLeft);
    await sort.press('Enter');
    await expect(sort).toBeFocused();
    await expect(sort.locator('..')).toHaveAttribute('aria-sort', 'descending');
    expect(await table.evaluate(node => node.scrollLeft)).toBeCloseTo(offset, 0);

    profiles[1].tracks[vegas] = {...nextLap, lap_time: 91.234};
    await page.goto('/apex/season/tracks?year=2026');
    await expect(choice).toHaveAttribute('aria-pressed', 'true');
    await expect(header).toContainText('1:31.234');
    await expect(header).not.toContainText('telemetry pending');
    const saoPaulo = page.getByRole('group', {name: 'Track'}).getByRole('button', {name: 'São Paulo Grand Prix'});
    await saoPaulo.press('Enter');
    await expect(saoPaulo).toBeFocused();
    await expect(header).toContainText('São Paulo');
    await page.goto('/apex/season/tracks?year=2026&track=Qatar+Grand+Prix');
    await expect(page.getByText('Waiting for qualifying telemetry for the 2026 Qatar Grand Prix.')).toBeVisible();
    await expect(page.getByRole('group', {name: 'Track'}).getByRole('button', {name: 'Qatar Grand Prix'})).toHaveAttribute('aria-pressed','true');
  });
}

for (const width of [1440, 390]) {
  test(`tracks and reliability use consistent section controls at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 1000});
    await page.addInitScript(theme => localStorage.setItem('apex-theme', theme), width === 390 ? 'light' : 'dark');
    await page.goto('/apex/season/tracks?year=2026&track=Brazilian+Grand+Prix');
    const zones = page.locator('.season-zones-section');
    await expect(zones.locator('.season-track-source')).toContainText('São Paulo');
    await expect(zones.getByRole('table', {name: 'Straight mode zones'})).toBeVisible();
    await expect(zones.getByRole('heading', {name: 'Overtake points'})).toBeVisible();
    expect(await zones.locator('.season-table-wrap').evaluate(n => n.scrollWidth - n.clientWidth)).toBeLessThanOrEqual(1);
    await zones.screenshot({path: test.info().outputPath('straight-mode.png')});
    await zones.getByRole('button', {name: '2025 DRS'}).click();
    await expect(zones.getByRole('table', {name: 'DRS zones'})).toBeVisible();
    expect(await zones.locator('.season-table-wrap').evaluate(n => n.scrollWidth - n.clientWidth)).toBeLessThanOrEqual(1);
    await zones.screenshot({path: test.info().outputPath('drs.png')});

    await page.goto('/apex/season/units?year=2026');
    let section = page.locator('.season-data-section').filter({has: page.getByRole('heading', {name: 'Power unit elements', exact: false})});
    await expect(section.getByRole('group', {name: 'Group by'})).toBeVisible();
    await page.getByRole('button', {name: 'Changes by round', exact: true}).click();
    section = page.locator('.season-data-section').filter({has: page.getByRole('heading', {name: 'Power unit elements used per race'})});
    await expect(section.locator('h3 + [aria-label="Group by"]')).toBeVisible();
    await section.getByRole('button', {name: 'Teams', exact: true}).click();
    await expect(section.getByRole('button', {name: 'Teams', exact: true})).toHaveAttribute('aria-pressed', 'true');
    await expect(section.getByRole('columnheader', {name: 'Team', exact: true})).toBeVisible();
    await section.screenshot({path: test.info().outputPath('changes-by-round.png')});
  });
}

test('head-to-head pace shading stops on both sides of a missing round', async ({page}) => {
  await page.setViewportSize({width: 390, height: 1000});
  const rounds = fixture.rounds.filter(round => round.race.length);
  const race = Object.fromEntries(rounds.map(({round}, i) => [round,
    i < 5 ? {RUS: 0, ...(i === 2 ? {} : {ANT: 0.2})} : {LEC: 0}]));
  await page.route('**/assets/data/season-pace/2026.json', r => r.fulfill({json: {race}}));
  await page.goto('/apex/season/h2h?year=2026&part=pace&a=antonelli&b=russell');
  const chart = page.locator('svg[aria-label="Race pace by round"]');
  const trace = chart.locator('path.line[data-id="antonelli"]');
  await expect(trace).toHaveAttribute('d', /^M[^M]+M[^M]+$/);
  const areas = chart.locator('path.line-area');
  await expect(areas).toHaveCount(3);
  const fills = await areas.evaluateAll(paths => paths.map(path => path.getAttribute('d')));
  const runs = (await trace.getAttribute('d')).match(/M[^M]+/g);
  expect(fills.slice(1)).toEqual(runs.map(run => expect.stringMatching(`^${run}L[^M]+Z$`)));
  expect(await chart.evaluate(svg => {
    const bounds = svg.getBoundingClientRect();
    return [...svg.querySelectorAll('.axis')].every(t => {
      const label = t.getBoundingClientRect();
      return !label.width || (label.left >= bounds.left - 1 && label.bottom <= bounds.bottom + 1);
    });
  })).toBe(true);
  await chart.screenshot({path: test.info().outputPath('pace.png')});
});

test('race review keeps its selected Grand Prix when opening the race or comparing the podium', async ({page}) => {
  await page.goto('/apex/');
  const select = page.locator('select[aria-label="Grand Prix to review"]');
  await expect(select).toBeAttached();
  const latest = Number(await select.inputValue());
  await page.getByRole('button', {name: 'Previous completed Grand Prix'}).click();
  expect(Number(await select.inputValue())).toBeLessThan(latest);
  await expect(page.getByRole('group', {name:'Grand Prix rounds'}).getByRole('button',{pressed:true})).toHaveCount(1);
  const round = fixture.rounds.find(r => r.race.length);
  await select.selectOption(String(round.round), {force: true});
  const pair = round.race.filter(x => x.position === 1 || x.position === 2).sort((a, b) => a.position - b.position);
  await page.getByRole('button', {name: / vs .* · season/}).click();
  expect(new URL(page.url()).searchParams.get('a')).toBe(pair[0].driver);
  expect(new URL(page.url()).searchParams.get('b')).toBe(pair[1].driver);
  await page.goBack();
  await expect(select).toHaveValue(String(round.round));
  await page.getByRole('button', {name: 'Race report', exact: true}).click();
  await expect(page.locator('tr').filter({has: page.locator('.season-row-toggle[aria-expanded="true"]')})).toContainText(round.name.replace(' Grand Prix', ''));
});

test('race details fit a phone and preserve row focus and sideways scroll', async ({page}, testInfo) => {
  await page.setViewportSize({width: 390, height: 1000});
  await page.addInitScript(() => localStorage.setItem('apex-theme', 'light'));
  const round = fixture.rounds.find(r => r.race.length);
  await page.goto('/apex/season/results?year=2026');
  const results = page.getByRole('region', {name: 'Race results'});
  const highlights = page.locator('.season-stats', {hasText: 'Most wins'});
  await expect(highlights.getByText('Biggest climb')).toBeVisible();
  expect((await highlights.boundingBox()).y).toBeLessThan((await results.boundingBox()).y);
  const roundButton = results.getByRole('button', {name: round.name, exact: true});
  await roundButton.focus();
  const offset = await results.evaluate(node => { node.scrollLeft = 120; return node.scrollLeft; });
  expect(offset).toBeGreaterThan(0);
  await page.keyboard.press('Enter');
  const details = results.locator('.season-detail-body');
  await expect(roundButton).toBeFocused();
  await expect(roundButton).toHaveAttribute('aria-expanded', 'true');
  expect(new URL(page.url()).searchParams.get('round')).toBe(String(round.round));
  expect(await results.evaluate(node => node.scrollLeft)).toBeCloseTo(offset, 0);
  const bounds = await details.evaluate(node => {
    const view = node.closest('.season-gp-table').parentElement.getBoundingClientRect();
    const detail = node.getBoundingClientRect();
    return detail.left >= view.left - 2 && detail.right <= view.right + 2;
  });
  expect(bounds).toBe(true);
  const close = details.getByRole('button', {name: 'Close results'});
  await expect(close).toBeInViewport();
  if (testInfo.project.name === 'chromium' && !process.env.CI) {
    await details.locator('.season-detail-actions').screenshot({path: testInfo.outputPath('race-details-phone.png')});
  }
  await close.press('Escape');
  await expect(roundButton).toBeFocused();
  await expect(details).toHaveCount(0);
  expect(await results.evaluate(node => node.scrollLeft)).toBeCloseTo(offset, 0);
});

test('qualifying is visible before the race and links open the requested session', async ({page}, testInfo) => {
  await page.setViewportSize({width: 1440, height: 1000});
  await page.addInitScript(() => localStorage.setItem('apex-theme', 'dark'));
  const completed = fixture.rounds.find(r => r.qualifying?.length);
  const preview = structuredClone(fixture);
  const vegas = preview.rounds.find(r => r.circuit_id === 'vegas');
  vegas.qualifying = completed.qualifying;
  vegas.race = [];
  await page.route('**/assets/data/season/' + entry.file, r => r.fulfill({json: preview}));
  await page.goto('/apex/season/results?year=2026');
  await expect(page.getByRole('table', {name: 'Race results'}).getByRole('button', {name: vegas.name})).toHaveCount(0);
  await page.getByRole('group', {name: 'Session', exact: true}).getByRole('button', {name: 'Qualifying', exact: true}).click();
  const qualifying = page.getByRole('table', {name: 'Qualifying results', exact: true});
  const vegasButton = qualifying.getByRole('button', {name: vegas.name, exact: true});
  await expect(vegasButton).toBeVisible();
  await vegasButton.click();
  await expect(vegasButton).toHaveAttribute('aria-expanded', 'true');
  await page.reload();
  await expect(vegasButton).toHaveAttribute('aria-expanded', 'true');
  expect(new URL(page.url()).searchParams.get('session')).toBe('qualifying');
  if (testInfo.project.name === 'chromium' && !process.env.CI) {
    await qualifying.locator('.season-detail-body .season-detail-actions').screenshot({path: testInfo.outputPath('qualifying-details-desktop.png')});
  }
  await page.getByRole('button', {name: 'By driver', exact: true}).click();
  await page.getByRole('button', {name: 'Qualifying', exact: true}).click();
  const flag = page.getByRole('link', {name: vegas.name + ' full result'});
  await expect(flag).toHaveAttribute('href', /round=21.*session=qualifying/);
  await flag.click();
  await expect(vegasButton).toBeFocused();
  await expect(vegasButton).toHaveAttribute('aria-expanded', 'true');
});

test('Tracks keeps the Season pills and clears selection on leaving', async ({page}) => {
  await page.goto('/apex/season/tracks?year=2026');
  // Tracks is a Season pill, not a rail row of its own: the rail's Season row is the one lit on Tracks.
  await expect(page.locator('.linear-navigation [data-season-tab="tracks"]')).toHaveCount(0);
  const season = page.locator('#seasonViewButton');
  await expect(season).toHaveAttribute('aria-pressed', 'true');
  // The Season pills stay on Tracks, with Tracks chosen, so every other page is one click away.
  await expect(page.locator('.season-tabs')).toBeVisible();
  await expect(page.locator('.season-tabs [data-season-tab="tracks"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.season-tabs [data-season-tab="h2h"]').click();
  await expect(page).toHaveURL(/\/season\/h2h/);
  await page.goBack();
  await page.locator('[data-analysis-view="session"]').click();
  await expect(season).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#seasonViewButton').click();
  await expect(page.locator('.season-tabs')).toBeVisible();
  await expect(page.locator('#seasonViewButton')).toHaveAttribute('aria-pressed', 'true');
});

for (const width of [390, 1024]) test.describe(`Head-to-head at ${width}px`, () => {
  test.use({viewport:{width, height:1000}});
  test(`head-to-head keeps both drivers readable at ${width}px`, async ({page}) => {
    await page.goto('/apex/season/h2h?year=2026');
    const hero = page.locator('.season-h2h-hero');
    await expect(hero).toBeVisible();
    const layout = await hero.evaluate(n => {
      const sides = [...n.querySelectorAll('.season-h2h-side')].map(x => x.getBoundingClientRect());
      const score = n.querySelector('.season-h2h-score').getBoundingClientRect();
      return {widths: sides.map(x => x.width), scoreTop: score.top, sideBottom: Math.max(...sides.map(x => x.bottom))};
    });
    expect(Math.min(...layout.widths)).toBeGreaterThan(120);
    expect(layout.scoreTop).toBeGreaterThanOrEqual(layout.sideBottom - 1);
    const legend = page.locator('.season-h2h-key');
    await expect(legend).toBeVisible();
    const raceByRace = legend.locator('..');
    await raceByRace.screenshot({path: test.info().outputPath('race-by-race.png')});
  });
});

for (const width of [390, 1440]) {
  test(`both head-to-head sections use one split bar and visible driver names at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:1000});
    await page.goto('/apex/season/h2h?year=2026&part=sessions');   // qualifying and race in detail live in the Sessions view
    const cards=page.locator('.season-h2h-sessions > .season-card');
    await expect(cards).toHaveCount(2);
    for(const card of await cards.all()){
      const names=card.locator('.season-h2h-head .season-h2h-name');
      await expect(names).toHaveCount(2);
      for(const name of await names.all())await expect(name).toBeVisible();
      const rows=card.locator('.season-h2h-row:not(.season-h2h-head)');
      const fit=await rows.evaluateAll(ns=>ns.every(n=>n.querySelectorAll('.season-h2h-split').length===1&&n.children.length===4&&n.scrollWidth<=n.clientWidth+1));
      expect(fit).toBe(true);
    }
  });
}

test('Tracks remains accessible from Season and team markers stay circular in rectangular slots',async({page})=>{
  await page.goto('/apex/season/standings?year=2026');
  await page.locator('.season-tabs [data-season-tab="tracks"]').click();
  await expect(page.locator('#seasonHub h1')).toHaveText('Tracks');
  const dot=await page.evaluate(()=>{
    const host=document.createElement('span');host.style.cssText='display:inline-block;width:24px;height:14px';
    host.innerHTML=window.ApexTeamMarks.teamMarkMarkup('Aston Martin');
    document.body.append(host);const mark=host.firstElementChild;mark.style.cssText+=';width:24px;height:14px';
    const s=getComputedStyle(mark,'::before');const result={width:s.width,height:s.height,radius:s.borderRadius};host.remove();return result;
  });
  expect(dot).toEqual({width:'8px',height:'8px',radius:'50%'});
});
