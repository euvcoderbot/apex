import {test,expect} from '@playwright/test';
import {isolate,replayFixture} from './helpers.mjs';

for(const width of [390,1440])for(const theme of ['dark','light']){
  test('Monaco start execution '+theme+' '+width,async({page},info)=>{
    await page.setViewportSize({width,height:900});
    await isolate(page);
    await replayFixture(page);
    await page.addInitScript(theme=>localStorage.setItem('apex-theme',theme),theme);
    await page.goto('/apex/cars/starts?year=2026&scope=tracks&races=6&run=1');
    const panel=page.locator('#performanceMetricPanel');
    await expect(panel.getByText('Monaco Grand Prix · 2026')).toBeVisible();
    await expect(panel.getByRole('columnheader',{name:/^20 m/})).toBeVisible();
    await expect(panel.getByRole('columnheader',{name:/^50 m/})).toHaveCount(0);
    await panel.getByRole('button',{name:'Teams',exact:true}).click();
    await panel.getByRole('button',{name:'Speed at distance',exact:true}).click();
    await expect(panel.getByText('Mercedes',{exact:true})).toBeVisible();
    await expect(panel.getByText(/km\/h/).first()).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
    const placement=await panel.locator('.start-comparison').evaluate(node=>{
      const profile=node.querySelector('.start-profile').getBoundingClientRect();
      const table=node.querySelector('.start-table').getBoundingClientRect();
      return {aligned:Math.abs(profile.top-table.top)<=1,stacked:profile.bottom<=table.top};
    });
    expect(width===390?placement.stacked:placement.aligned).toBe(true);
    await panel.getByRole('combobox',{name:'Driver',exact:true}).click();
    await panel.getByRole('option',{name:/^RUS/}).click();
    await expect(panel.getByRole('group',{name:'Launch speed by distance for RUS'})).toBeVisible();
    await panel.screenshot({path:info.outputPath('standing.png')});
    await panel.getByRole('button',{name:'Safety-car releases'}).click();
    await expect(panel.getByRole('columnheader',{name:'At green'})).toBeVisible();
    await panel.screenshot({path:info.outputPath('rolling.png')});
  });
}
