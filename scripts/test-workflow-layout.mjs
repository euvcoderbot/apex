import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import postcss from 'postcss';
const app=readFileSync('app.js','utf8'),page=readFileSync('index.html','utf8'),ui=readFileSync('dashboard-ui.js','utf8'),css=readFileSync('macos-ui.css','utf8');

test('lap selection collapses without losing its contents and has a reliable edit action',()=>{
  const elements=new Map();
  const $=id=>{if(!elements.has(id))elements.set(id,{hidden:false,inert:false,attributes:{},label:{},setAttribute(k,v){this.attributes[k]=v;},querySelector(){return this.label;},focus(){this.focused=true;}});return elements.get(id);};
  const box={$};vm.createContext(box);
  vm.runInContext(app.slice(app.indexOf('function setLapSelectionExpanded('),app.indexOf('function setSessionAnalysisView(')),box);
  box.setLapSelectionExpanded(false,true);
  assert.equal($('#lapSelectionBody').hidden,true);assert.equal($('#lapSelectionBody').inert,true);
  assert.equal($('#lapWorkspaceToggle').attributes['aria-expanded'],'false');assert.equal($('#lapWorkspaceToggle').label.textContent,'Edit laps');assert.equal($('#lapWorkspaceToggle').focused,true);
  box.setLapSelectionExpanded(true);
  assert.equal($('#lapSelectionBody').hidden,false);assert.equal($('#lapSelectionBody').inert,false);
  assert.equal($('#sidebarToggle').hidden,false);
  assert.match(app,/if \(loaded.length\) setLapSelectionExpanded\(false, true\)/);
});

test('analysis tabs switch presentation, retain data and redraw without fetching',()=>{
  const buttons=['traces','corners'].map(view=>({dataset:{sessionView:view},attributes:{},setAttribute(k,v){this.attributes[k]=v;}}));
  let redraws=0;
  const chart={},box={sessionAnalysisView:'traces',document:{querySelectorAll:()=>buttons},$:()=>chart,updateTelemetryVisibility(){},scheduleDrawAll(){redraws++;}};
  vm.createContext(box);
  const code=app.slice(app.indexOf('function setSessionAnalysisView('),app.indexOf('// UI Rendering Functions'));
  vm.runInContext(code,box);box.setSessionAnalysisView('corners');
  assert.equal(chart.hidden,true);assert.equal(buttons[1].attributes['aria-selected'],'true');assert.equal(buttons[1].tabIndex,0);
  box.setSessionAnalysisView('traces');assert.equal(chart.hidden,false);assert.equal(buttons[0].tabIndex,0);
  assert.equal(redraws,2);
  assert.doesNotMatch(code,/fetch|telemetryCache\.clear|loaded\s*=/);
  assert.match(page,/id="charts" role="tabpanel" aria-labelledby="sessionTracesTab"/);
});

test('the analysis canvas reclaims setup width and controls remain local to their charts',()=>{
  postcss.parse(css);
  assert.match(css,/main \{ display: block/);
  assert.match(css,/#lapSelectionBody \{ display: grid; grid-template-columns: 220px/);
  assert.match(css,/#performanceResults > \.performance-toolbar > \.performance-mode \{[^}]*flex-direction: row/);
  assert.match(ui,/metric === 'pace'.*placeControls/);assert.match(ui,/metric === 'straight'.*placeControls/);
  assert.match(ui,/summary.textContent = 'Inspect a tyre run'/);
  assert.match(page,/id="performanceTrackChoices"/);
});
