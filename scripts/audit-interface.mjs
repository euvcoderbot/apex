// Repeatable diagnostic audit. Generated evidence is not a visual baseline.
import {chromium} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {isolate,replayFixture} from '../e2e/helpers.mjs';

const origin=process.argv[2]||'http://127.0.0.1:54150';
const output=path.resolve(process.argv[3]||'test-results/interface-audit');
const live=process.argv.includes('--live');
await mkdir(output,{recursive:true});
const browser=await chromium.launch();
const report={origin,live,fixture:live?null:'car-performance.json.gz',pages:[]};
try{
  for(const theme of ['dark','light']){
    const context=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:theme});
    const page=await context.newPage();const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    if(!live){await isolate(page);await replayFixture(page);}
    for(const category of ['catalog','home','pace','corners','straight','braking','pits','tyres','trend','results']){
      const url=category==='catalog'?'/apex/ui-catalog.html':category==='home'?'/apex/':`/apex/cars/${category}?year=2026&scope=tracks&races=16,17,18&run=1`;
      await page.goto(origin+url);await page.waitForLoadState('networkidle');
      await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
      await page.waitForTimeout(300);
      const scan=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
      const row={category,theme,errors:[...errors],violations:scan.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,
        nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),layouts:[]};
      for(const width of [1440,1024,768,390,320]){
        await page.setViewportSize({width,height:1000});
        await page.waitForTimeout(450); // Settle the documented 320 ms view/layout motion.
        row.layouts.push(await page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth})));
      }
      await page.setViewportSize({width:1440,height:1000});
      await page.screenshot({path:path.join(output,`${category}-${theme}.png`),fullPage:category==='catalog'});
      report.pages.push(row);
      console.log(JSON.stringify({category,theme,violations:row.violations.map(v=>[v.id,v.nodes.length]),layouts:row.layouts,errors:row.errors}));
    }
    await context.close();
  }
}finally{await browser.close();await writeFile(path.join(output,'audit.json'),JSON.stringify(report,null,2));}
