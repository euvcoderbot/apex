import {appSource} from './app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import postcss from 'postcss';
const read=f=>readFileSync(f,'utf8');
const css=read('ui-controls.css'),car=read('car-performance.js'),app=appSource(),ui=read('dashboard-ui.js');

test('lap states cannot wrap and wide tyre/development layouts use bounded label columns',()=>{
  const hig=read('hig-system.css');
  assert.match(hig,/\.lap-workspace \.lap-chip\[data-ui-kind="choice"\] \{[^}]*height: 44px;[^}]*grid-template-rows: 18px 14px/);
  assert.match(hig,/\.lap-workspace \.lap-chip \.lap-token \{[^}]*flex-wrap: nowrap; white-space: nowrap/);
  assert.match(hig,/\.lap-workspace \.lap-chip \.lap-tyre-age \{[^}]*white-space: nowrap/);
  assert.match(hig,/performance-trend-table \.performance-table:not\(\.ui-resized-table\) \{ table-layout: fixed/);
  assert.match(hig,/#carPerformance \.performance-tyre-age-row \{ grid-template-columns: minmax\(0,14em\) minmax\(60px,1fr\) 12ch/);
});

test('targeted UI fixes keep panels separate, controls contained and units visible',()=>{
  const hig=read('hig-system.css'),corners=read('session-corners.js');
  assert.match(hig,/container: telemetry \/ inline-size/);
  assert.match(hig,/@container telemetry \(max-width: 1050px\)[\s\S]*grid-template-areas: "corner" "charts"/);
  assert.match(hig,/#loadedLaps \.loaded-lap-pill \{ min-height: 26px; height: 26px/);
  assert.match(hig,/\.lap-chip\.is-preparation\[aria-pressed="true"\] \.lap-state \{ color: var\(--ui-accent\)/);
  assert.match(hig,/summary-lap-time > strong \{ font-weight: 700/);
  assert.match(hig,/performance-bar-row \{ grid-template-columns: minmax\(0,14em\) minmax\(32px,1fr\) max-content/);
  assert.match(hig,/performance-tyre-age-row \+ \.performance-tyre-age-row \{ border-top: 1px solid var\(--ui-separator\)/);
  assert.match(ui,/primaryBody\.prepend\(group\)/);
  assert.match(corners,/sectionTime\.toFixed\(3\)\+'s'/);
  assert.doesNotMatch(corners,/signedDelta\(toReference\)\.replace/);
});

test('all primary sections share a heading policy and one unforced filter band',()=>{
  const hig=read('hig-system.css');
  assert.match(ui,/heading\.parentElement === primaryCard/);
  assert.match(ui,/sectionControls.*performance-scope-toggle,\.performance-pit-controls,\.performance-results-measure,\.performance-actions/);
  assert.match(ui,/group\.append\(\.\.\.control\.children\); control\.remove\(\)/);
  assert.match(hig,/performance-card-controls > \.performance-scope-toggle \{ margin: 0/);
  assert.match(hig,/performance-card-controls \[data-ui-group="segments"\] \{ flex: 0 1 auto; width: fit-content/);
  assert.match(hig,/performance-card-controls:empty \{ display: none/);
  assert.match(hig,/performance-card-controls \.performance-tyre-toolbar,\.performance-card-controls \.performance-tyre-settings \{ display: contents/);
  assert.match(ui,/!el\.matches\('\.performance-stat-toggle'\)/);
  assert.doesNotMatch(ui,/\['straight','braking','pits'\]\.includes\(metric\)/);
});

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
  const tokenCss=read('tokens.css');assert.match(tokenCss,/--ui-control-height: 30px/);assert.match(tokenCss,/--ui-control-font: 14px/);assert.match(tokenCss,/@media\s*\(pointer:coarse\)[\s\S]*--ui-control-height: 44px/);
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
