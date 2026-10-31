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

test('segment selection moves through intermediate frames and reverses on rapid input',async({page})=>{
  await page.goto('/apex/ui-catalog.html');
  const group=page.locator('[data-catalog-section="segmented-choices"] [data-ui-group="segments"]').first();
  await expect(group).toHaveAttribute('data-ui-thumb','sliding');
  const frames=await group.evaluate(async group=>{
    const buttons=[...group.querySelectorAll('button:not(:disabled)')];
    const x=()=>new DOMMatrix(getComputedStyle(group,'::before').transform).m41;
    const choose=index=>{buttons.forEach((b,i)=>b.setAttribute('aria-pressed',String(i===index)));window.ApexUI.decorate(group.parentElement);};
    const values=[];choose(0);await new Promise(r=>setTimeout(r,300));
    const start=x();choose(1);
    await new Promise(resolve=>{let n=0;const frame=()=>{values.push(x());if(++n===5){choose(0);}if(n<30)requestAnimationFrame(frame);else resolve();};requestAnimationFrame(frame);});
    return {start,values,end:x()};
  });
  expect(Math.max(...frames.values)-frames.start).toBeGreaterThan(2);
  expect(frames.values.some(v=>v>frames.start+1&&v<Math.max(...frames.values))).toBe(true);
  expect(Math.abs(frames.end-frames.start)).toBeLessThan(1);
  await page.emulateMedia({reducedMotion:'reduce'});
  expect(await group.evaluate(el=>parseFloat(getComputedStyle(el,'::before').transitionDuration))).toBeLessThanOrEqual(.001);
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
