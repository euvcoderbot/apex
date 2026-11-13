// Route states shared by the QA audits (audit-charts.mjs, audit-a11y.mjs): each loads one view with the replay fixtures or
// the static Season snapshot, so every audit renders exactly the same pages.
import {isolate, replayFixture} from '../e2e/helpers.mjs';

export function qaStates(origin) {
  const session = async page => {
    await isolate(page); await replayFixture(page, 'session-view.json.gz');
    await page.goto(origin + '/apex?year=2026'); await page.waitForSelector('#gp option', {state: 'attached'});
    await page.evaluate(() => { const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change', {bubbles: true})); }; set('gp', '16'); set('session', 'Qualifying'); });
    await page.evaluate(() => document.getElementById('loadSession').click());
    await page.waitForFunction(() => document.querySelectorAll('#driverPills button').length > 4, null, {timeout: 60000});
    await page.evaluate(() => { const p = document.querySelectorAll('#driverPills button'); p[0].click(); p[4].click(); });
    await page.waitForTimeout(500);
    await page.evaluate(() => { toggleLoadedLap('VER', 11); toggleLoadedLap('LEC', 11); });
    await page.waitForTimeout(2500);
  };
  const states = {'session-loaded': session};
  for (const m of ['pace', 'corners', 'straight', 'braking', 'pits', 'tyres', 'trend', 'results'])
    states['cars-' + m] = async page => {
      await isolate(page); await replayFixture(page);
      await page.goto(`${origin}/apex/cars/${m}?year=2026&scope=tracks&races=16,17,18&run=1`);
      await page.locator('#performanceMetricPanel:not([aria-busy="true"])').waitFor({timeout: 60000});
      await page.waitForTimeout(1500);
    };
  for (const t of ['schedule', 'results', 'standings', 'form', 'drivers', 'h2h', 'upgrades', 'units'])
    states['season-' + t] = async page => {
      await page.goto(`${origin}/apex/season/${t}?year=2026`);
      await page.locator('#seasonHub .season-body > :not(.season-loading)').first().waitFor({timeout: 30000});
      await page.waitForTimeout(1200);
    };
  return states;
}
