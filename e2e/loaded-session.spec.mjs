import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';

const data=new URL('../assets/data/',import.meta.url);
const read=file=>JSON.parse(readFileSync(new URL(file,data)));
const packed=file=>JSON.parse(gunzipSync(readFileSync(new URL(file,data))));
const captures=read('local-captures/index.json'),packs=read('local-telemetry/index.json');
const sessionEntry=Object.entries(captures.entries).find(([key])=>key.startsWith('/api/session?')&&key.includes('United+States')&&key.includes('session=Qualifying'));
const session=packed('local-captures/'+sessionEntry[1].file);
const performanceEntry=Object.entries(captures.entries).find(([key])=>key.startsWith('/api/performance?')&&key.includes('United+States')&&key.includes('session=Q'));
const performance=packed('local-captures/'+performanceEntry[1].file);
const calendar=[{year:2026,round:18,name:'United States Grand Prix',country:'United States',location:'Austin',date:'2026-10-25',sessions:['Practice 1','Qualifying','Race'],session_statuses:{Qualifying:'completed'}}];

async function loaded(page,{missing=false}={}){
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route(/127\.0\.0\.1:54123/,route=>route.abort());
  await page.route('**/config.js*',route=>route.fulfill({contentType:'text/javascript',body:'window.APEX_API_ORIGIN="";window.APEX_SNAPSHOT_MODE=false;window.APEX_LOCAL_MODE=true;'}));
  await page.route('**/api/**',async route=>{
    const outer=new URL(route.request().url());
    const url=new URL(outer.searchParams.get('path')||outer.pathname+outer.search,'http://fixture');
    let payload;
    if(url.pathname==='/api/events')payload=calendar;
    else if(url.pathname==='/api/session')payload=session;
    else if(url.pathname==='/api/performance'&&url.searchParams.get('session')==='Q')payload=performance;
    else if(url.pathname==='/api/telemetry'){
      if(missing&&url.searchParams.get('driver')==='VER')return route.fulfill({status:503,contentType:'application/json',body:'{"detail":"Telemetry unavailable for this lap"}'});
      const code=url.searchParams.get('driver'),file=packs.entries[`2026:United States Grand Prix:Qualifying:${code}`];
      if(file)payload=packed('local-telemetry/'+file).laps[url.searchParams.get('lap')];
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
