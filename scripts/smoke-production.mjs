// Explicitly invoked, read-only production smoke. Does not mock data or publish.
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const origin=process.argv[2];
if(!origin||!/^https:\/\//.test(origin))throw Error('Provide the exact HTTPS production origin');
const output=path.resolve(process.argv[3]||'test-results/production-smoke');await mkdir(output,{recursive:true});
const browser=await chromium.launch();const report={origin,checked_at:new Date().toISOString(),pages:[]};
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  for(const [name,url] of [['qualifying','/apex/?year=2026&round=18&session=Qualifying&laps=ANT.14,VER.8'],
    ['historical-calendar','/apex/?year=2025'],...['pace','corners','straight','braking','pits','tyres','trend','results'].map(c=>[c,`/apex/cars/${c}?year=2026&scope=tracks&races=16,17,18&run=1`])]){
    const errors=[],failures=[];
    const onError=e=>errors.push(e.message),onResponse=r=>{if(r.status()>=400)failures.push({status:r.status(),path:new URL(r.url()).pathname+new URL(r.url()).search});};
    page.on('pageerror',onError);page.on('response',onResponse);
    const response=await page.goto(origin+url,{waitUntil:'networkidle',timeout:60000});
    await page.waitForTimeout(2000);
    const state=await page.evaluate(()=>({title:document.title,source:window.APEX_SOURCE_VERSION,backend:window.APEX_BACKEND_VERSION,
      measurement:window.APEX_MEASUREMENT_VERSION,snapshot:window.APEX_SNAPSHOT_MODE,
      drivers:document.querySelectorAll('#driverPills .driver-pill').length,traces:document.querySelectorAll('input[data-trace-key]').length,
      rows:document.querySelectorAll('.performance-bar-row,.performance-tyre-age-row').length,
      notices:[...document.querySelectorAll('.performance-quality-status,.performance-empty,.session-status')].map(e=>e.innerText).filter(Boolean)}));
    await page.screenshot({path:path.join(output,name+'.png')});
    const row={name,status:response.status(),...state,errors,failures};report.pages.push(row);console.log(JSON.stringify(row));
    page.off('pageerror',onError);page.off('response',onResponse);
  }
}finally{await browser.close();await writeFile(path.join(output,'smoke.json'),JSON.stringify(report,null,2));}
