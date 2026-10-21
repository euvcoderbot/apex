import {appSource} from './app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const car=readFileSync('car-performance.js','utf8'),app=appSource(),ui=readFileSync('dashboard-ui.js','utf8'),css=readFileSync('ui-controls.css','utf8');
const windowCss=readFileSync('macos-window.css','utf8');

test('unverified transition links are not exposed as selectable controls',()=>{
  assert.doesNotMatch(app,/Other links|Select transition zones|picker\('transition'\)/);
  assert.doesNotMatch(css,/circuit-links/);
  assert.match(app,/selectLinkingStraights\(zones,selectedCornerIndices,automaticStraightIndices\)/,'automatic connecting windows remain intact');
});

test('category, filter, corner and refresh controls share token sizing',()=>{
  for(const selector of ['.category-bar .category-tab,.category-bar .category-tab[data-ui-kind="tab"]',
    '.circuit-section-group .corner-picker button.corner-pick',
    '#performanceMetricPanel .metric-heading-controls .metric-refresh',
    '#performanceMetricPanel .metric-heading-controls [data-ui-group="segments"] > button[data-ui-kind="segment"]']){
    const start=windowCss.indexOf(selector+' {');
    assert.ok(start>=0,selector);
    const body=windowCss.slice(start,windowCss.indexOf('}',start));
    assert.match(body,/height: var\(--ui-control-height\)/,selector);
  }
  assert.match(windowCss,/corner-pick \{[^}]*white-space: nowrap/);
  assert.match(windowCss,/#dominanceCanvas \{ height: clamp\(180px,28dvh,260px\); min-height: 0/);
  assert.match(windowCss,/@media\(pointer:coarse\)[\s\S]*min-height: 44px/);
});

test('modelled phase diagnostic cannot change primary driver row height',()=>{
  const rows=app.slice(app.indexOf('const rows = rankedMetrics.map'),app.indexOf('updateCornerPicker(pickerRoot,',app.indexOf('const rows = rankedMetrics.map')));
  assert.doesNotMatch(rows,/phaseSplit\(item.lap\)/);
  assert.match(app,/<details class="corner-phase-evidence"><summary>Modelled entry \/ exit diagnostic/);
  assert.doesNotMatch(app,/as in the season cornering metric/);
});

test('loaded session context comes from loaded data, not pending selector values',()=>{
  assert.match(readFileSync('index.html','utf8'),/id="loadedSessionContext"[^>]*hidden/);
  const body=app.slice(app.indexOf('function renderAll()'),app.indexOf('function rankCornerMetrics'));
  assert.match(body,/sessionYear.*sessionEventName.*loadedSessionName/);
  assert.doesNotMatch(body,/\$\('#year'\)|\$\('#gp'\)/);
});

test('only speed-trace flags produce source-gap approximations on shared charts',()=>{
  const box={finite:Number.isFinite,escape:String,color:()=> '#888',teamLabel:r=>r.team,
    fmt:(v,d,u)=>v.toFixed(d)+u,signed:(v,d,u)=>v.toFixed(d)+u};
  vm.createContext(box);
  vm.runInContext(car.slice(car.indexOf('function renderHorizontalBarChart('),car.indexOf('function lapShareChart(')),box);
  const html=(row)=>box.renderHorizontalBarChart([{team:'A',value:0,...row}],{unit:' pts',signedValue:false});
  assert.doesNotMatch(html({provisional:true}),/source gaps|≈/,'generic provisional fields must not masquerade as telemetry gaps');
  assert.match(html({traceProvisional:true}),/source gaps over 0.6 s/);
  assert.match(car,/traceProvisional:r.provisional/);
});

test('mean and median change multi-GP race pace, not the qualifying statistic',()=>{
  const box={};vm.createContext(box);
  // Shared helpers live in performance-format.js (plain consts once exports are dropped).
  vm.runInContext(readFileSync('performance-format.js','utf8').replace(/^export /gm,''),box);
  vm.runInContext(car.slice(car.indexOf('function rebase('),car.indexOf('function renderHorizontalBarChart(')),box);
  vm.runInContext(car.slice(car.indexOf('function summarisePaceTeams('),car.indexOf('function renderPace(')),box);
  const teams=[{team:'A',q:[1,3,20].map(pace=>({pace})),adjDeficits:[1,3,20],r:[2,4,24]},{team:'B',q:[0,0,0].map(pace=>({pace})),adjDeficits:[0,0,0],r:[0,0,0]}];
  const mean=box.summarisePaceTeams(teams,'mean'),median=box.summarisePaceTeams(teams,'median');
  assert.ok(Math.abs(mean[0].race-10)<1e-10);assert.ok(Math.abs(median[0].race-4)<1e-10);
  assert.ok(Math.abs(mean[0].qualy-8)<1e-10);assert.ok(Math.abs(median[0].qualy-8)<1e-10);
  const one=teams.map(t=>({...t,q:t.q.slice(0,1),r:t.r.slice(0,1)}));
  assert.equal(box.summarisePaceTeams(one,'mean')[0].race,box.summarisePaceTeams(one,'median')[0].race);
  assert.match(car,/events\.filter\(e=>e\.R\?\.teams\?\.length\)\.length>2/);
  assert.match(ui,/performance-stat-toggle.*pace-visual-grid/);
});

test('supporting straight and braking tables are closed and deferred before DOM insertion',()=>{
  const box={};vm.createContext(box);
  vm.runInContext(car.slice(car.indexOf('function table('),car.indexOf('function card(')),box);
  for(const key of ['straightTeam','eventStraightTeam','brakeTeam','eventBrakeTeam']){
    const html=box.table([`<button data-performance-sort="${key}">Team</button>`],[['A']]);
    assert.match(html,/^<details class="performance-evidence primary-measurements"><summary>/);
    assert.doesNotMatch(html,/<details[^>]+\bopen\b/);
  }
  assert.doesNotMatch(ui,/measurement-table-heading|entries`/);
  assert.match(car,/function deferPerformanceEvidence/);
  assert.doesNotMatch(ui,/performance-chart-evidence|Straight-line rankings and acceleration/);
});

test('retired view switches, annotation table and lap selection marks have no remaining app code',()=>{
  assert.doesNotMatch(app,/sessionAnalysisView|setSessionAnalysisView|renderSpeedAnnotationEvidence|speedAnnotationEvidence|lap-selection-mark|trace-color-picker/);
  assert.match(app,/drawMapHover\(\)/);
  assert.match(css,/grid-template-columns: minmax\(0,1fr\) min\(48%,540px\)/);
  assert.match(css,/#driverSidebar #driverPills \{[^}]*max-height: none; overflow: visible/);
  assert.match(css,/lap-chip > \.compound-badge \{ grid-area: 1 \/ 3/);
  assert.match(css,/grid-template-rows: subgrid/);
});
