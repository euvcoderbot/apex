// Dumps the computed style of every visible element on the main views (fixture data, 1440 and 390 wide, dark and light), so a
// CSS refactor can be proven to change nothing: dump before, dump after, compare.
//
//   node scripts/dump-computed.mjs <origin> <output.json>
import {chromium} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {replayFixture, isolate} from '../e2e/helpers.mjs';

const [origin, output] = [process.argv[2], process.argv[3]];
const PROPS = ['display', 'position', 'width', 'height', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right',
  'padding-bottom', 'padding-left', 'border-top-width', 'border-top-color', 'border-left-width', 'border-left-color', 'border-bottom-color', 'background-color',
  'background-image', 'color', 'font-size', 'font-weight', 'line-height', 'overflow-x', 'overflow-y', 'opacity', 'transform', 'grid-template-columns',
  'min-height', 'max-height', 'box-shadow', 'clip', 'white-space', 'flex-direction', 'gap'];
const pages = ['/apex', '/apex/ui-catalog.html', ...['pace', 'corners', 'straight', 'braking', 'pits', 'tyres', 'trend', 'results'].map(c => `/apex/cars/${c}?year=2026&scope=tracks&races=16,17,18&run=1`)];
const out = {};
const browser = await chromium.launch();
for (const [width, height] of [[1440, 900], [390, 844]]) for (const scheme of ['dark', 'light']) {
  const context = await browser.newContext({viewport: {width, height}, colorScheme: scheme, reducedMotion: 'reduce'});
  for (const path of pages) {
    const page = await context.newPage();
    await isolate(page); await replayFixture(page);
    await page.goto(origin + path);
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(2500);
    await page.addStyleTag({content: '*,*::before,*::after{transition:none!important;animation:none!important}'});
    out[`${width} ${scheme} ${path}`] = await page.evaluate(props => [...document.querySelectorAll('body, body *')].map((el, i) => {
      const cs = getComputedStyle(el);
      return `${i} ${el.tagName}#${el.id}.${String(el.className).slice(0, 50)} ` + props.map(p => cs.getPropertyValue(p)).join('|');
    }), PROPS);
    await page.close();
  }
  await context.close();
}
await browser.close();
writeFileSync(output, JSON.stringify(out));
console.log('pages', Object.keys(out).length);
