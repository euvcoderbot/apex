import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';

const {session,performance,telemetry}=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/qualifying-comparison.json.gz',import.meta.url))));
const calendar=[{year:2026,round:18,name:'United States Grand Prix',country:'United States',location:'Austin',date:'2026-10-25',sessions:['Practice 1','Qualifying','Race'],session_statuses:{Qualifying:'completed'}}];

async function loaded(page,{missing=false,partial=false,corners=null,wind=null}={}){
  const sessionData=wind?{...session,drivers:session.drivers.map(driver=>({...driver,laps:driver.laps.map(lap=>({
    ...lap,conditions:{...lap.conditions,...wind},
  }))}))}:session;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route(/127\.0\.0\.1:54123/,route=>route.abort());
  await page.route('**/config.js*',route=>route.fulfill({contentType:'text/javascript',body:'window.APEX_API_ORIGIN="";window.APEX_SNAPSHOT_MODE=false;window.APEX_LOCAL_MODE=true;'}));
  await page.route('**/api/**',async route=>{
    const outer=new URL(route.request().url());
    const url=new URL(outer.searchParams.get('path')||outer.pathname+outer.search,'http://fixture');
    let payload;
    if(url.pathname==='/api/events')payload=calendar;
    else if(url.pathname==='/api/session')payload=partial?{...sessionData,lap_data_complete:false,
      telemetry_complete:false,drivers:sessionData.drivers.map((driver,i)=>i?driver:{...driver,
        lap_data_complete:false,missing_laps:[2],telemetry_missing_laps:[2]})}:corners?{...sessionData,corners}:sessionData;
    else if(url.pathname==='/api/performance'&&url.searchParams.get('session')==='Q')payload=performance;
    else if(url.pathname==='/api/telemetry'){
      if(missing&&url.searchParams.get('driver')==='VER')return route.fulfill({status:503,contentType:'application/json',body:'{"detail":"Telemetry unavailable for this lap"}'});
      payload=telemetry[url.searchParams.get('driver')]?.[url.searchParams.get('lap')];
    }
    return route.fulfill({status:payload?200:404,contentType:'application/json',body:JSON.stringify(payload||{detail:'Not available in this fixture'})});
  });
  await page.goto('/apex/?year=2026&round=18&session=Qualifying&laps=ANT.14,VER.8');
  await expect(page.locator('#driverPills .driver-pill')).toHaveCount(22);
  return errors;
}

test('recorded qualifying comparison renders both laps and supports trace toggles',async({page})=>{
  const errors=await loaded(page);
  await expect(page.locator('canvas[data-chart="Speed trace"]')).toBeVisible();
  await expect(page.locator('input[data-trace-key]')).toHaveCount(2);
  const toggle=page.locator('input[data-trace-key]').first();
  await toggle.focus();await toggle.press('Space');await expect(toggle).not.toBeChecked();
  await toggle.press('Space');await expect(toggle).toBeChecked();
  expect(errors).toEqual([]);
});

test('driver summary sorts the same field and toggles a fastest lap', async ({page}, info) => {
  const errors = await loaded(page);
  await page.getByRole('button', {name: 'Driver summary', exact: true}).click();
  const table = page.getByRole('region', {name: 'Session summary'});
  const best = table.getByRole('button', {name: /VER fastest lap, lap 8/});
  await expect(best).toHaveAttribute('aria-pressed', 'true');
  expect(await table.evaluate(region => {
    const identity = region.querySelector('tbody th');
    const firstOffset = identity.getBoundingClientRect().left - region.getBoundingClientRect().left;
    region.scrollLeft = region.scrollWidth;
    return region.scrollLeft > 0 && Math.abs(identity.getBoundingClientRect().left - region.getBoundingClientRect().left - firstOffset) < 1;
  })).toBe(true);
  await best.press('Enter');
  await expect(best).toHaveAttribute('aria-pressed', 'false');
  await expect(best).toBeFocused();
  await best.press('Space');
  await expect(best).toHaveAttribute('aria-pressed', 'true');
  const trap = table.getByRole('button', {name: 'Trap km/h'});
  await trap.click();
  await expect(table.getByRole('columnheader', {name: 'Trap km/h'})).toHaveAttribute('aria-sort', 'descending');
  await expect(trap).toBeFocused();
  const speeds = await table.locator('tbody tr').evaluateAll(rows => rows.map(row => Number(row.cells[8].textContent)).filter(Number.isFinite));
  expect(speeds.length).toBeGreaterThan(1);
  expect(speeds).toEqual([...speeds].sort((a,b) => b-a));
  await expect(best).toHaveAttribute('aria-pressed', 'true');
  if (info.project.name === 'chromium' && !process.env.CI) await table.screenshot({path:info.outputPath('driver-summary.png')});
  expect(errors).toEqual([]);
});

test('lap cards share aligned sector bars at desktop widths',async({page},info)=>{
  await page.setViewportSize({width:2400,height:1000});
  await page.emulateMedia({reducedMotion:'reduce'});
  const errors=await loaded(page,{wind:{wind_speed:18.8,wind_direction:315}});
  const cards=page.locator('#sectorRows .lap-summary-card');
  await expect(cards).toHaveCount(2);
  for (const card of await cards.all()) {
    const layout=await card.evaluate(node=>{
      const bounds=selector=>node.querySelector(selector).getBoundingClientRect();
      const {width,height,left}=node.getBoundingClientRect();
      const driver=bounds('header'), conditions=bounds('.summary-conditions');
      const sectors=bounds('.summary-sectors'), total=bounds('.summary-lap-time');
      return {width,height,leftPadding:driver.left-left,sectorWidth:sectors.width,
        gaps:[conditions.left-driver.right,sectors.left-conditions.right,total.left-sectors.right],
        fits:node.scrollWidth<=node.clientWidth+1};
    });
    expect(layout.width).toBeGreaterThanOrEqual(1100);
    expect(layout.height).toBeLessThanOrEqual(54);
    expect(layout.leftPadding).toBeGreaterThanOrEqual(20);
    expect(layout.sectorWidth).toBeLessThanOrEqual(Math.min(layout.width*.42,720));
    expect(Math.min(...layout.gaps)).toBeGreaterThanOrEqual(20);
    expect(layout.fits).toBe(true);
  }
  expect(errors).toEqual([]);
  if (info.project.name==='chromium'&&!process.env.CI) {
    await page.locator('#sectorRows').screenshot({path:info.outputPath('wide-lap-cards.png')});
  }
  for (const width of [2400,1600,1440]) {
    await page.setViewportSize({width,height:1000});
    const rows=await cards.evaluateAll(nodes=>nodes.map(node=>
      [...node.querySelectorAll('.sector-status-line')].map(line=>{
        const {left,width}=line.getBoundingClientRect();
        return {left,width};
      })
    ));
    expect(rows[0]).toHaveLength(3);
    expect(rows[1]).toEqual(rows[0]);
    expect(Math.max(...rows[0].map(bar=>bar.width))-Math.min(...rows[0].map(bar=>bar.width))).toBeLessThan(1);
    const weatherGap=await cards.first().locator('.summary-conditions').evaluate(node=>{
      const [air,rain]=node.querySelectorAll('.summary-condition');
      return rain.getBoundingClientRect().left-air.getBoundingClientRect().right;
    });
    expect(weatherGap).toBeCloseTo(8);
    const timingRows=await cards.nth(1).locator('.sector-cell-value').evaluateAll(nodes=>nodes.map(node=>{
      const label=node.querySelector('small').getBoundingClientRect();
      const pair=node.querySelector('.sector-time-pair').getBoundingClientRect();
      const gap=parseFloat(getComputedStyle(node).columnGap);
      const needed=label.width+pair.width+gap;
      const available=node.getBoundingClientRect().width;
      const inline=pair.left>=label.right+gap-.5 && Math.abs(pair.top-label.top)<8;
      return {needed,available,inline};
    }));
    for (const row of timingRows) {
      if (Math.abs(row.needed-row.available)>.5) {
        expect(row.inline, `${width}px viewport, ${row.needed}px needed in ${row.available}px`).toBe(row.needed<row.available);
      }
    }
  }
});

for (const width of [1440,390]) {
  test('sector and comparison layouts fit and the lap picker works at ' + width + 'px', async ({page},testInfo)=>{
    await page.setViewportSize({width,height:900});
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.addInitScript(theme=>localStorage.setItem('apex-theme',theme),width===390?'light':'dark');
    const errors=await loaded(page,{corners:[{number:1,fraction:.06},{number:12,fraction:.42},{number:19,fraction:.83}],
      wind:{wind_speed:18.8,wind_direction:315}});
    const tray=page.getByRole('group',{name:'Loaded comparison laps'});
    const lapCards=page.locator('#sectorRows');
    await expect(lapCards.locator('.summary-condition').getByText('Rain',{exact:true})).toHaveCount(2);
    await expect(lapCards.locator('.summary-condition').getByText('18.8 m/s NW',{exact:true})).toHaveCount(2);
    await expect(lapCards.locator('.summary-condition-label i[aria-hidden="true"]')).toHaveText(['🌤️','🌧️','🌡️','💨','🌤️','🌧️','🌡️','💨']);
    for (const panel of [tray,lapCards,page.locator('#charts .speed-chart'),page.locator('#sessionOverview .overview-chart')]) {
      await expect.poll(()=>panel.evaluate(node=>node.scrollWidth-node.clientWidth)).toBeLessThanOrEqual(1);
    }
    const sector=lapCards.locator('.lap-summary-card').nth(1).locator('.sector-cell').filter({has:page.locator('.sector-minis')}).first();
    await expect(sector).toBeVisible();
    const sectorLayout=await sector.evaluate(node=>{
      const bounds=selector=>node.querySelector(selector).getBoundingClientRect();
      const label=bounds('small'), delta=bounds('.summary-delta'), time=bounds('strong');
      const line=bounds('.sector-status-line'), minis=bounds('.sector-minis');
      return {
        deltaToTime: time.left-delta.right,
        timeToLine: line.top-time.bottom,
        lineToMinis: minis.top-line.bottom,
        sameRow: Math.max(delta.top,time.top)<Math.min(delta.bottom,time.bottom),
        labelClear: label.right<=delta.left || label.bottom<=delta.top,
        fits: time.right<=node.getBoundingClientRect().right+.5,
        matchingColour: getComputedStyle(node.querySelector('strong')).color === getComputedStyle(node.querySelector('.sector-status-line')).backgroundColor,
        equalMarks: bounds('.sector-minis i').height === line.height && line.height === 4,
      };
    });
    expect(sectorLayout.deltaToTime,'gap between delta and time').toBeGreaterThanOrEqual(-.5);
    expect(sectorLayout.deltaToTime,'delta sits directly beside the sector time').toBeLessThanOrEqual(8);
    expect(sectorLayout.timeToLine).toBeGreaterThanOrEqual(0);
    expect(sectorLayout.timeToLine).toBeLessThanOrEqual(4);
    expect(sectorLayout.lineToMinis).toBeGreaterThanOrEqual(0);
    expect(sectorLayout.lineToMinis).toBeLessThanOrEqual(4);
    expect(sectorLayout.sameRow).toBe(true);
    expect(sectorLayout.labelClear).toBe(true);
    expect(sectorLayout.fits).toBe(true);
    expect(sectorLayout.matchingColour && sectorLayout.equalMarks).toBe(true);
    await expect(page.getByRole('button',{name:'Saved comparisons'})).toHaveCount(0);
    await expect(lapCards.locator('.summary-lap-time .summary-delta')).toHaveText([/^\+0\.000s/, /^\+0\.179s/]);
    await expect(lapCards.locator('.summary-lap-time > .is-even')).toHaveCount(1);
    await expect(lapCards.locator('.summary-lap-time > .is-slower')).toHaveCount(1);
    {
      const card=lapCards.locator('.lap-summary-card').nth(1);
      expect(await card.evaluate((node,width)=>{
        const bounds=selector=>node.querySelector(selector).getBoundingClientRect();
        const driver=bounds('header');
        const sectors=bounds('.summary-sectors'), conditions=bounds('.summary-conditions');
        const total=bounds('.summary-lap-time'), time=bounds('.summary-lap-time > strong'), gap=bounds('.summary-lap-time > .summary-delta');
        const sample=document.createElement('span');
        sample.style.color='var(--ui-negative)';
        node.append(sample);
        const negative=getComputedStyle(sample).color;
        sample.remove();
        const isRed=getComputedStyle(node.querySelector('.summary-lap-time > .summary-delta')).color===negative;
        const ordered=width===1440
          ? driver.right<=conditions.left && conditions.right<=sectors.left && node.getBoundingClientRect().height<=56
          : driver.right<=conditions.left && conditions.bottom<=sectors.top;
        return ordered && isRed && sectors.right<=total.left && gap.right<=time.left &&
          [...node.querySelectorAll('.summary-condition')].every(reading=>{
            const label=reading.querySelector('.summary-condition-label').getBoundingClientRect();
            const value=reading.querySelector('strong').getBoundingClientRect();
            return reading.scrollWidth<=reading.clientWidth+1 && label.right<=value.left &&
              Math.max(label.top,value.top)<Math.min(label.bottom,value.bottom);
          });
      },width)).toBe(true);
    }
    if (testInfo.project.name==='chromium'&&!process.env.CI) {
      for (const theme of ['dark','light']) {
        await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
        await tray.screenshot({path:testInfo.outputPath(`comparison-${theme}.png`)});
        await lapCards.screenshot({path:testInfo.outputPath(`sectors-${theme}.png`)});
        await page.locator('#sessionOverview .overview-chart').screenshot({path:testInfo.outputPath(`overview-${theme}.png`)});
        await page.locator('#timeSummary').screenshot({path:testInfo.outputPath(`time-summary-${theme}.png`)});
        await page.locator('#charts .speed-chart').screenshot({path:testInfo.outputPath(`speed-${theme}.png`)});
      }
      await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},width===390?'light':'dark');
    }
    const toggle=page.locator('#lapWorkspaceToggle');
    const dialog=page.getByRole('dialog',{name:'Choose laps'});
    const driverList=width===1440?page.locator('#linearWorkspace .linear-drivers'):dialog;
    if (width===390) await toggle.click();
    const driver=driverList.locator('.driver-pill[data-code="VER"]');
    await expect(driver).toBeVisible();
    await driver.click();
    await expect(driver).toHaveAttribute('aria-pressed','false');
    await driver.click();
    await expect(driver).toHaveAttribute('aria-pressed','true');
    if (width===1440) {
      await toggle.click();
      await expect(dialog.locator('#driverPills')).toHaveCount(0);
    }
    await expect(dialog.getByRole('searchbox',{name:'Find a driver'})).toHaveCount(0);
    const fastest=dialog.locator('#compareAllFastest');
    if (await fastest.getAttribute('aria-pressed')==='false') await fastest.click();
    await expect(fastest).toHaveAttribute('aria-pressed','true');
    if (testInfo.project.name==='chromium'&&!process.env.CI) {
      await dialog.screenshot({path:testInfo.outputPath('lap-chooser.png')});
    }
    await dialog.getByRole('button',{name:'Close lap chooser'}).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('#loadedLaps .comparison-lap-gap').first()).toHaveText(/^[+−]\d+\.\d{3} s$/);
    expect(errors).toEqual([]);
  });
}

test('telemetry display controls apply to every graph and retain independent annotations',async({page},testInfo)=>{
  // Observe text actually painted on each canvas, rather than only control state.
  await page.addInitScript(()=>{
    const original=CanvasRenderingContext2D.prototype.fillText;
    const clear=CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect=function(...args){
      this.canvas.paintedLabels=[];
      return clear.apply(this,args);
    };
    CanvasRenderingContext2D.prototype.fillText=function(text,...args){
      (this.canvas.paintedLabels??=[]).push(String(text));
      return original.call(this,text,...args);
    };
  });
  // The recorded fixture carries no corner positions; give this test three, as lap fractions, so corner labels can be painted.
  const errors=await loaded(page,{corners:[{number:1,fraction:.06},{number:12,fraction:.42},{number:19,fraction:.83}]});
  const canvases=page.locator('canvas[data-chart]');
  // The heading shows the event's country flag before its name (as on the Grand Prix chip).
  await expect(page.locator('#loadedSessionContext')).toContainText('United States Grand Prix');
  await expect(page.locator('#loadedSessionContext img.title-flag')).toHaveAttribute('src',/flags\/us\.svg$/);
  const painted=()=>canvases.evaluateAll(nodes=>nodes.map(c=>({name:c.dataset.chart,labels:c.paintedLabels||[]})));
  await expect.poll(async()=> (await painted()).every(c=>c.labels.some(t=>/^T\d/.test(t)))).toBe(true);
  // The styled switch's label covers its input, as for a person: click the label, then check the state.
  const toggle=async(id,on)=>{
    const input=page.locator('#'+id);
    if(await input.isChecked()!==on)await page.locator('label.trace-setting',{has:input}).click();
    await expect(input).toBeChecked({checked:on});
  };
  await page.locator('.trace-display-menu').first().locator('summary').click();
  await toggle('distanceNumbersToggle',false);
  await expect.poll(async()=> (await painted()).every(c=>!c.labels.some(t=>/^\d+ M$/.test(t)))).toBe(true);
  await toggle('speedAnnotationToggle',true);
  await toggle('cornerToggle',false);
  await expect.poll(async()=> (await painted()).every(c=>!c.labels.some(t=>/^T\d/.test(t)))).toBe(true);
  await expect(page.locator('#speedAnnotationToggle')).toBeChecked();
  await toggle('cornerToggle',true);
  await page.locator('.trace-display-menu').first().locator('summary').click();
  await page.locator('#telemetryCard').screenshot({path:testInfo.outputPath('telemetry-display.png')});
  await page.reload();
  await expect(page.locator('canvas[data-chart="Speed trace"]')).toBeVisible();
  await expect(page.locator('#distanceNumbersToggle')).not.toBeChecked();
  expect(errors).toEqual([]);
});

test('qualifying phases, empty comparison alignment and compute settings remain usable', async ({page}) => {
  const errors = await loaded(page);
  await expect(page.locator('.run-segment strong').filter({hasText: /^Stint/})).toHaveCount(0);
  await page.locator('#clearComparison').click();
  const alignment = await page.locator('#telemetryCard .comparison-tray').evaluate(root => {
    const heading = root.querySelector('.comparison-tray-heading').getBoundingClientRect();
    const message = root.querySelector('.section-empty').getBoundingClientRect();
    return [Math.abs(heading.left - message.left), message.top - heading.bottom];
  });
  expect(alignment[0]).toBeLessThan(1);
  expect(alignment[1]).toBeGreaterThan(0);
  // Compute on this PC is offered in Compute settings; nothing on the PC is contacted until it is chosen.
  await page.getByRole('button', {name: 'Compute settings', exact: true}).click();
  await expect(page.locator('#computeSettings')).toBeVisible();
  await expect(page.locator('#computeSettings [data-compute-use]')).toHaveText('Use this PC');
  await expect(page.locator('#computeSettings [data-compute-status]')).toContainText('published data');
  await page.keyboard.press('Escape');
  // A presentation-only narrow-header fixture: no synthetic telemetry enters
  // the comparison. Include the widest selectable speed heading and its icon.
  const overflow = await page.locator('.app-inspector').evaluate(root => {
    const fixture = document.createElement('div');
    fixture.innerHTML = '<table class="corner-measurement-table"><thead><tr><th>Driver</th><th>Time s</th><th>Delta s</th><th aria-sort="ascending"><button data-corner-sort="speed"><span>Min <small>km/h</small></span><svg viewBox="0 0 12 16"></svg></button></th></tr></thead></table>';
    root.append(fixture);
    const cell = fixture.querySelector('th:last-child'), button = cell.querySelector('button');
    const result = Math.max(button.scrollWidth - button.clientWidth,
      button.getBoundingClientRect().right - cell.getBoundingClientRect().right);
    fixture.remove();
    return result;
  });
  expect(overflow).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('inspect a measured gain or loss with the keyboard', async ({page}) => {
  const errors = await loaded(page, {corners: [{number: 1, fraction: .06}, {number: 12, fraction: .42}, {number: 19, fraction: .83}]});
  const action = page.locator('#timeSummary [data-inspect-zone]').first();
  await expect(action).toBeVisible();
  const summary = page.locator('#timeSummary');
  const bars = await summary.locator('.time-summary-meter i').evaluateAll(nodes=>nodes.map(node=>parseFloat(node.style.width)));
  expect(bars.length).toBeGreaterThan(1);
  expect(Math.max(...bars)).toBe(100);
  expect(Math.min(...bars)).toBeGreaterThan(0);
  // The whole row is the button (list-row recipe), not underlined text.
  expect(await action.evaluate(b => [getComputedStyle(b).textDecorationLine, getComputedStyle(b).boxShadow, b.closest('li').getBoundingClientRect().width - b.getBoundingClientRect().width])).toEqual(['none', 'none', 0]);
  await summary.screenshot({path: test.info().outputPath('time-summary.png')});
  const desktop = page.viewportSize();
  await page.setViewportSize({width:390,height:900});
  expect(await summary.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
  expect(await summary.locator('[data-inspect-zone]').evaluateAll(nodes=>Math.max(...nodes.map(node=>node.getBoundingClientRect().height)))).toBeLessThanOrEqual(28);
  await summary.screenshot({path: test.info().outputPath('time-summary-phone.png')});
  await page.setViewportSize(desktop);
  await page.locator('#sectorRows').screenshot({path: test.info().outputPath('sectors.png')});
  await page.locator('#sessionOverview').screenshot({path: test.info().outputPath('overview.png')});
  const index = await action.getAttribute('data-inspect-zone');
  await action.focus();
  await action.press('Enter');
  const picked = page.locator(`#cornerPickerRow [data-corner-index="${index}"]`);
  await expect(picked).toHaveAttribute('aria-pressed', 'true');
  await expect(picked).toBeFocused();
  expect(errors).toEqual([]);
});

test('partial source history discloses gaps without blocking supported comparisons',async({page})=>{
  const errors=await loaded(page,{partial:true});
  await expect(page.locator('canvas[data-chart="Speed trace"]')).toBeVisible();
  await expect(page.locator('input[data-trace-key]')).toHaveCount(2);
  await expect(page.locator('#appToast')).toContainText('missing data is not estimated');
  expect(errors).toEqual([]);
});

test('loaded car-performance views survive repeated navigation without uncaught errors',async({page})=>{
  // This checks for errors, not animation. Linux WebKit on CI does not settle the view transition a tab switch runs, so
  // the next tab never looks stable to Playwright; reduced motion switches tabs without one (motion.js), as it does for people.
  await page.emulateMedia({reducedMotion:'reduce'});
  const errors=await loaded(page);
  await page.getByRole('tab',{name:'Car performance',exact:true}).click();
  await page.locator('#performanceLoad').click();
  await expect(page.locator('.performance-bar-row').first()).toBeVisible();
  for(let i=0;i<2;i++){
    await page.getByRole('tab',{name:'Finishes & retirements',exact:true}).click();
    await page.getByRole('tab',{name:'Pace',exact:true}).click();
    await expect(page.locator('.performance-bar-row').first()).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('one unavailable lap leaves the supported comparison usable without uncaught errors',async({page})=>{
  const errors=await loaded(page,{missing:true});
  await expect(page.locator('canvas[data-chart="Speed trace"]')).toBeVisible();
  await expect(page.locator('body')).toContainText(/Telemetry.*unavailable|unavailable.*VER/i);
  expect(errors).toEqual([]);
});

test('loaded charts remain contained at a narrow viewport',async({page})=>{
  await page.setViewportSize({width:768,height:900});
  const errors=await loaded(page);
  await expect(page.locator('canvas[data-chart="Speed trace"]')).toBeVisible();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);
  expect(overflow).toBe(false);expect(errors).toEqual([]);
});
