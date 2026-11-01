import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';

const {session,performance,telemetry}=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/qualifying-comparison.json.gz',import.meta.url))));
const calendar=[{year:2026,round:18,name:'United States Grand Prix',country:'United States',location:'Austin',date:'2026-10-25',sessions:['Practice 1','Qualifying','Race'],session_statuses:{Qualifying:'completed'}}];

async function loaded(page,{missing=false,partial=false}={}){
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
        lap_data_complete:false,missing_laps:[2],telemetry_missing_laps:[2]})}:session;
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

test('qualifying phases, empty comparison alignment and compute settings remain usable', async ({page}) => {
  const errors = await loaded(page);
  await expect(page.locator('.run-segment strong').filter({hasText: /^Stint/})).toHaveCount(0);
  await page.locator('#clearComparison').click();
  const centers = await page.locator('.comparison-tray').evaluate(root => {
    const center = el => { const r = el.getBoundingClientRect(); return r.y + r.height / 2; };
    return [center(root.querySelector('.comparison-tray-heading')), center(root.querySelector('.section-empty'))];
  });
  expect(Math.abs(centers[0] - centers[1])).toBeLessThan(1);
  await expect(page.locator('.workspace-tools > .local-compute-status')).toHaveCount(0);
  await page.getByRole('button', {name: 'Compute settings', exact: true}).click();
  await expect(page.locator('#computeSettings')).toBeVisible();
  await expect(page.locator('#computeSettings .local-compute-status')).toBeVisible();
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

test('partial source history discloses gaps without blocking supported comparisons',async({page})=>{
  const errors=await loaded(page,{partial:true});
  await expect(page.locator('canvas[data-chart="Speed trace"]')).toBeVisible();
  await expect(page.locator('input[data-trace-key]')).toHaveCount(2);
  await expect(page.locator('#appToast')).toContainText('missing data is not estimated');
  expect(errors).toEqual([]);
});

test('loaded car-performance views survive repeated navigation without uncaught errors',async({page})=>{
  const errors=await loaded(page);
  await page.getByRole('tab',{name:'Car performance',exact:true}).click();
  await page.locator('#performanceLoad').click();
  await expect(page.locator('.performance-bar-row').first()).toBeVisible();
  for(let i=0;i<2;i++){
    await page.getByRole('tab',{name:'Reliability & results',exact:true}).click();
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
