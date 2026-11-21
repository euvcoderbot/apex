import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';

const {session,performance,telemetry}=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/qualifying-comparison.json.gz',import.meta.url))));
const calendar=[{year:2026,round:18,name:'United States Grand Prix',country:'United States',location:'Austin',date:'2026-10-25',sessions:['Practice 1','Qualifying','Race'],session_statuses:{Qualifying:'completed'}}];

async function loaded(page,{missing=false,partial=false,corners=null}={}){
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route(/127\.0\.0\.1:54123/,route=>route.abort());
  await page.route('**/config.js*',route=>route.fulfill({contentType:'text/javascript',body:'window.APEX_API_ORIGIN="";window.APEX_SNAPSHOT_MODE=false;window.APEX_LOCAL_MODE=true;'}));
  await page.route('**/api/**',async route=>{
    const outer=new URL(route.request().url());
    const url=new URL(outer.searchParams.get('path')||outer.pathname+outer.search,'http://fixture');
    let payload;
    if(url.pathname==='/api/events')payload=calendar;
    else if(url.pathname==='/api/session')payload=partial?{...session,lap_data_complete:false,
      telemetry_complete:false,drivers:session.drivers.map((driver,i)=>i?driver:{...driver,
        lap_data_complete:false,missing_laps:[2],telemetry_missing_laps:[2]})}:corners?{...session,corners}:session;
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

for (const width of [1440,390]) {
  test('lap chooser searches and updates the comparison at ' + width + 'px', async ({page},testInfo)=>{
    await page.setViewportSize({width,height:900});
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.addInitScript(theme=>localStorage.setItem('apex-theme',theme),width===390?'light':'dark');
    const errors=await loaded(page);
    const toggle=page.locator('#lapWorkspaceToggle');
    await toggle.click();
    const dialog=page.getByRole('dialog',{name:'Choose laps'});
    const search=dialog.getByRole('searchbox',{name:'Find a driver'});
    const visibleDrivers=dialog.locator('.driver-pill:visible');
    await expect(search).toBeFocused();
    await search.fill('no matching car');
    await expect(dialog.getByRole('status',{name:''}).filter({hasText:'No matching drivers'})).toBeVisible();
    await expect(visibleDrivers).toHaveCount(0);
    await search.fill('ver');
    await expect(visibleDrivers).toHaveCount(1);
    await search.press('ArrowDown');
    await expect(visibleDrivers.first()).toBeFocused();
    await expect(visibleDrivers.first()).toHaveAttribute('data-code','VER');
    await visibleDrivers.first().press('Enter');
    await expect(visibleDrivers.first()).toHaveAttribute('aria-pressed','false');
    await search.fill('verstappen');
    await search.press('Enter');
    await expect(visibleDrivers.first()).toHaveAttribute('aria-pressed','true');
    await dialog.locator('#compareAllFastest').click();
    await expect(dialog.locator('#compareAllFastest')).toHaveAttribute('aria-pressed','true');
    const view=dialog.getByRole('button',{name:'View comparison',exact:true});
    await expect(view).toBeInViewport();
    await dialog.evaluate(node=>{node.scrollTop=0;});
    expect(await dialog.evaluate((node,width)=>{
      const header=node.querySelector('.linear-lap-header').getBoundingClientRect();
      const driver=node.querySelector('#driverSidebar').getBoundingClientRect();
      const laps=node.querySelector('#stintPanels').getBoundingClientRect();
      return header.bottom<=Math.min(laps.top,driver.top)+1 &&
        (width===390?driver.bottom<=laps.top+1:driver.right<=laps.left+1);
    },width)).toBe(true);
    if (testInfo.project.name==='chromium'&&!process.env.CI) {
      await dialog.screenshot({path:testInfo.outputPath('lap-chooser.png')});
    }
    await view.click();
    await expect(dialog).toBeHidden();
    const reference=page.locator('#loadedLaps .loaded-lap-main[aria-pressed="true"]');
    await expect(reference).toBeFocused();
    await expect(page.locator('#loadedLaps .comparison-lap-gap').first()).toHaveText(/^[+−]\d+\.\d{3} s$/);
    await toggle.click();
    await expect(search).toHaveValue('');
    expect(errors).toEqual([]);
  });
}

for (const width of [1440,390]) {
  test('a saved comparison reopens its exact laps and reference at ' + width + 'px',async({page},testInfo)=>{
    await page.setViewportSize({width,height:900});
    await page.addInitScript(theme=>localStorage.setItem('apex-theme',theme),width===390?'light':'dark');
    await page.addInitScript(()=>{
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.copiedComparison=value;}}});
    });
    const errors=await loaded(page);
    const toggle=page.getByRole('button',{name:'Saved comparisons'});
    const library=page.getByRole('region',{name:'Saved comparisons'});
    await toggle.click();
    await library.getByRole('button',{name:'Save current comparison'}).click();
    const reopen=library.getByRole('link',{name:/ANT L14.*VER L8/});
    await expect(reopen).toBeVisible();
    expect(await library.evaluate(node=>node.scrollWidth-node.clientWidth)).toBeLessThanOrEqual(1);
    if(testInfo.project.name==='chromium'&&!process.env.CI)await library.screenshot({path:testInfo.outputPath('saved-comparison.png')});
    await expect(library.getByRole('button',{name:'Save current comparison'})).toBeDisabled();
    await library.getByRole('button',{name:'Copy current link'}).click();
    const copied=await page.evaluate(()=>window.copiedComparison);
    expect(new URL(copied).searchParams.get('laps')).toBe('ANT.14,VER.8');
    await page.locator('#clearComparison').click();
    await expect(page.locator('#loadedLaps .loaded-lap-pill')).toHaveCount(0);
    await reopen.click();
    await expect(page.locator('#loadedLaps .loaded-lap-main').first()).toContainText('ANT');
    await expect(page.locator('#loadedLaps .loaded-lap-main[aria-pressed="true"]')).toContainText('L14');
    await toggle.click();
    await library.getByRole('button',{name:/Remove .* comparison/}).click();
    await expect(library.getByRole('link')).toHaveCount(0);
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
  const centers = await page.locator('#telemetryCard .comparison-tray').evaluate(root => {
    const center = el => { const r = el.getBoundingClientRect(); return r.y + r.height / 2; };
    return [center(root.querySelector('.comparison-tray-heading')), center(root.querySelector('.section-empty'))];
  });
  expect(Math.abs(centers[0] - centers[1])).toBeLessThan(1);
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
  // The whole row is the button (list-row recipe), not underlined text.
  expect(await action.evaluate(b => [getComputedStyle(b).textDecorationLine, getComputedStyle(b).boxShadow, b.closest('li').getBoundingClientRect().width - b.getBoundingClientRect().width])).toEqual(['none', 'none', 0]);
  await page.locator('#timeSummary').screenshot({path: test.info().outputPath('time-summary.png')});
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
