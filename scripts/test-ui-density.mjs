import {appSource} from './app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import postcss from 'postcss';
const read=f=>readFileSync(f,'utf8');
const css=read('ui-controls.css'),car=read('car-performance.js'),app=appSource(),ui=read('dashboard-ui.js');

test('regular controls share tokenised type, height and spacing without fixed-height segment shells',()=>{
  const root=postcss.parse(css);
  const rules=[];root.walkRules(r=>rules.push(r));
  const group=rules.find(r=>r.selector==='[data-ui-group="segments"]');
  const values=Object.fromEntries(group.nodes.filter(n=>n.type==='decl').map(d=>[d.prop,d.value]));
  assert.equal(values.height,'auto');assert.equal(values['min-height'],'0');assert.equal(values['flex-wrap'],'wrap');
  const button=rules.find(r=>r.selector==='[data-ui-group="segments"] > button[data-ui-kind="segment"]');
  const props=Object.fromEntries(button.nodes.filter(n=>n.type==='decl').map(d=>[d.prop,d.value]));
  assert.equal(props.height,'var(--ui-control-height)');assert.equal(props['font-size'],'var(--ui-control-font)');
  assert.equal(props['white-space'],'nowrap');
  assert.match(css,/--ui-control-height: 30px/);assert.match(css,/--ui-control-font: 14px/);assert.match(css,/@media\(pointer:coarse\)[\s\S]*--ui-control-height: 44px/);
});

test('main comparisons have no vertical height cap and no redundant ranking footer',()=>{
  assert.match(css,/\.performance-split-view > \.performance-table-wrap \{ max-height: none; height: auto; overflow-x: auto; overflow-y: visible/);
  const chart=readFileSync('src/components/BarChart.tsx','utf8');
  assert.doesNotMatch(chart,/chart-coverage/);
  assert.match(chart,/is-unranked/); // Missing observations remain distinguishable from measured zeros.
  assert.doesNotMatch(ui,/performance-chart-evidence/);
});

test('speed ranges and results use pressed-state pills and retire their dropdown handlers',()=>{
  // Reliability & results is a React view: a segmented control of data-results-chart buttons.
  const resultsView=readFileSync('src/views/ResultsView.tsx','utf8'),segmented=readFileSync('src/components/SegmentedControl.tsx','utf8');
  assert.match(resultsView,/<SegmentedControl name="results-chart"/);
  assert.match(segmented,/<button[^>]+\{\.\.\.\{\[attribute\]: key\}\} aria-pressed=/);
  assert.doesNotMatch(car,/data-straight-band-select|data-results-chart-select/);
  assert.match(read('ui-system.js'),/\.performance-range-options/);
});

test('corner inspector has explicit grouped selection sections instead of floating headings',()=>{
  assert.match(app,/circuit-section-group"><header><h3>Corners/);
  assert.match(app,/circuit-section-group"><header><h3>Straights/);
  assert.doesNotMatch(app,/<details class="circuit-section-group circuit-links"/);
  assert.match(css,/circuit-section-group \.corner-picker \{ display: grid/);
  assert.match(css,/corner-picker-row \{ order: 1; padding: var\(--ui-space-3\); border-top/);
});
