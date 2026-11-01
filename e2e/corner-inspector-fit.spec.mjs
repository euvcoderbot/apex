import {test, expect} from '@playwright/test';
import {isolate} from './helpers.mjs';

// Presentation fixture only: exercise the exact inspector/table structure at
// four comparisons and seventeen buttons, without inventing source telemetry.
for (const height of [850, 1000]) test(`corner results fit at ${height}px without nested scrollbars or picker reflow`, async ({page}, info) => {
  await page.setViewportSize({width: 1600, height});
  await isolate(page);
  await page.goto('/apex/');
  await page.evaluate(() => {
    const inspector = document.querySelector('#sessionInspector');
    inspector.dataset.pane = 'track';
    document.querySelector('#cornerAnalysis').hidden = false;
    document.querySelector('#dominanceEmpty').style.display = 'none';
    document.querySelector('#dominanceCanvas').style.display = 'block';
    document.querySelector('#dominanceLegend').textContent = 'HAM L19 · RUS L21 · LEC L23 · VER L10';
    document.querySelector('#cornerPickerRow').innerHTML = '<section class="circuit-section-group"><header><h3>Corners</h3><span>Choose one or more</span></header><nav class="corner-picker">'
      + Array.from({length: 17}, (_, i) => `<button class="corner-pick"><strong>T${i + 1}</strong></button>`).join('')
      + '</nav></section><section class="circuit-section-group"><header><h3>Straights</h3></header><nav class="corner-picker straight-zone-picker">'
      + ['before T1', 'T3–T4', 'T6–T7'].map(t => `<button class="corner-pick"><strong>${t}</strong></button>`).join('') + '</nav></section>';
    document.querySelector('#cornerMetricGrid').innerHTML = '<div class="corner-selection-empty"><strong>Compare a section</strong><span>Select corners or straights above to inspect their times.</span></div>';
  });
  const before = await page.locator('.corner-picker').first().locator('button').evaluateAll(els => els.map(e => e.getBoundingClientRect().y));
  await page.evaluate(() => {
    document.querySelector('#cornerMetricGrid').innerHTML = '<article class="corner-detail-card"><div class="corner-measurement-wrap"><table class="corner-measurement-table"><thead><tr><th>Driver</th>'
      + ['Time s', 'Delta s', 'Min km/h'].map(t => `<th><button data-corner-sort="time"><span>${t}</span><svg width="8" height="14"></svg></button></th>`).join('')
      + '</tr></thead><tbody>' + ['HAM', 'RUS', 'LEC', 'VER'].map(t => `<tr><th><span class="corner-driver"><span class="team-logo" style="width:18px;height:18px"></span><span class="corner-driver-copy"><b>${t}</b><small>L19 REF</small></span></span></th><td><strong>4.790s</strong></td><td><strong>+0.298s</strong></td><td><strong>100.1</strong></td></tr>`).join('')
      + '</tbody></table></div></article>';
  });
  const after = await page.locator('.corner-picker').first().locator('button').evaluateAll(els => els.map(e => e.getBoundingClientRect().y));
  // The map may shrink vertically, but the number of button columns is stable.
  const relative = ys => ys.map(y => Math.round(y - ys[0]));
  expect(relative(after)).toEqual(relative(before));
  const geometry = await page.locator('#sessionInspector').evaluate(root => ({
    overflow: root.scrollHeight - root.clientHeight,
    nestedOverflow: [...root.querySelectorAll('.corner-measurement-wrap,.corner-measurement-table')].map(e => e.scrollWidth - e.clientWidth),
    bottom: root.querySelector('.corner-detail-card').getBoundingClientRect().bottom,
    limit: root.getBoundingClientRect().bottom,
  }));
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  expect(geometry.nestedOverflow.every(n => n <= 1)).toBeTruthy();
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.limit);
  if (height === 1000) await page.screenshot({path: info.outputPath('corner-inspector-fit.png')});
  // Short windows may scroll the inspector, but every measurement stays reachable.
  await page.setViewportSize({width: 1600, height: 600});
  await page.locator('.corner-measurement-table tbody tr').last().scrollIntoViewIfNeeded();
  await expect(page.locator('.corner-measurement-table tbody tr').last()).toBeInViewport();
});
