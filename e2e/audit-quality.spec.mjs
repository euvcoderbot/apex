import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {isolate,replayFixture} from './helpers.mjs';

test('removed segmented controls release resize observation and can be reinserted',async({page})=>{
  await page.addInitScript(()=>{
    const Native=ResizeObserver;window.__observedThumbs=new Set();
    window.ResizeObserver=class extends Native{
      observe(element,options){window.__observedThumbs.add(element);return super.observe(element,options);}
      unobserve(element){window.__observedThumbs.delete(element);return super.unobserve(element);}
    };
  });
  await page.goto('/apex/ui-catalog.html');
  await page.evaluate(()=>{
    const root=document.createElement('div');root.id='auditRemoved';document.body.append(root);
    for(let i=0;i<30;i++){
      const group=document.createElement('div');group.className='performance-scope-toggle';
      group.innerHTML='<button aria-pressed="true">A</button><button>B</button>';
      root.append(group);window.ApexUI.decorate(root);group.remove();
    }
    root.remove();
  });
  await expect.poll(()=>page.evaluate(()=>[...window.__observedThumbs].filter(e=>!e.isConnected).length)).toBe(0);
});

for(const theme of ['dark','light'])test(`shared shell and loaded tyre view meet automated accessibility rules: ${theme}`,async({page})=>{
  test.setTimeout(60000); // Axe scans the full loaded data view in WebKit.
  await isolate(page);await replayFixture(page);
  await page.addInitScript(t=>localStorage.setItem('apex-theme',t),theme);
  await page.goto('/apex/cars/tyres?year=2026&scope=tracks&races=16,17,18&run=1');
  await page.waitForLoadState('networkidle');
  const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
  expect(result.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}))).toEqual([]);
});

test('tyre chart stays inside its card after narrowing from desktop to phone',async({page})=>{
  test.setTimeout(60000);
  await isolate(page);await replayFixture(page);
  await page.goto('/apex/cars/tyres?year=2026&scope=tracks&races=16,17,18&run=1');
  await page.waitForLoadState('networkidle');
  for(const width of [1440,1024,768,390,320]){
    await page.setViewportSize({width,height:900});await page.waitForTimeout(450);
    const overflow=await page.locator('.performance-tyre-age-row').evaluateAll(rows=>Math.max(...rows.map(e=>{
      const card=e.closest('.performance-chart-card').getBoundingClientRect();
      return Math.max(...[...e.children].map(child=>child.getBoundingClientRect().right-card.right));
    })));
    expect(overflow,`width ${width}`).toBeLessThanOrEqual(1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),`document width ${width}`).toBeLessThanOrEqual(1);
  }
});


test('modal keyboard focus cannot reach background page controls and returns to its trigger',async({page})=>{
  await page.goto('/apex/ui-catalog.html');
  const trigger=page.locator('#catalogDialogButton'),dialog=page.locator('#catalogDialog');
  await trigger.focus();await trigger.press('Enter');await expect(dialog).toBeVisible();
  for(let i=0;i<12;i++){
    await page.keyboard.press(i%3===0?'Shift+Tab':'Tab');
    // Native dialog permits focus to reach browser chrome (activeElement is
    // BODY). It must never reach an inert background page control.
    expect(await dialog.evaluate(el=>el.contains(document.activeElement)||document.activeElement===document.body)).toBe(true);
  }
  if(await page.evaluate(()=>document.activeElement===document.body))await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(trigger).toBeFocused();
});

test('catalogue keeps controls contained at 320 CSS pixels',async({page})=>{
  await page.setViewportSize({width:320,height:900});
  await page.goto('/apex/ui-catalog.html');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(0);
});
