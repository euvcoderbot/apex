import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const car=readFileSync('car-performance.js','utf8'),app=readFileSync('app.js','utf8'),ui=readFileSync('dashboard-ui.js','utf8'),css=readFileSync('ui-controls.css','utf8');

test('mean and median change multi-GP race pace, not the qualifying statistic',()=>{
  const box={};vm.createContext(box);
  vm.runInContext(car.slice(car.indexOf('const finite ='),car.indexOf('const middle50Label')),box);
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
  assert.match(ui,/metric==='straight'&&!grid.closest\('details'\)/);
  assert.match(ui,/Straight-line rankings and acceleration/);
});

test('retired view switches, annotation table and lap selection marks have no remaining app code',()=>{
  assert.doesNotMatch(app,/sessionAnalysisView|setSessionAnalysisView|renderSpeedAnnotationEvidence|speedAnnotationEvidence|lap-selection-mark|trace-color-picker/);
  assert.match(app,/drawMapHover\(\)/);
  assert.match(css,/grid-template-columns: minmax\(0,1fr\) min\(48%,540px\)/);
  assert.match(css,/#driverSidebar #driverPills \{[^}]*max-height: none; overflow: visible/);
  assert.match(css,/lap-chip > \.compound-badge \{ grid-area: 1 \/ 3/);
  assert.match(css,/grid-template-rows: subgrid/);
});
