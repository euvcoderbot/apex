import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import postcss from 'postcss';

const ui=readFileSync('dashboard-ui.js','utf8');
const html=readFileSync('index.html','utf8');
const css=readFileSync('workspace-ui.css','utf8');
const car=readFileSync('car-performance.js','utf8');

test('every performance category has a distinct accessible heading and honest context',()=>{
  const box={window:{},document:{getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[]}};
  vm.createContext(box);vm.runInContext(ui,box);
  for(const metric of ['pace','corners','straight','braking','pits','tyres','trend','results']){
    const heading=box.window.ApexPresentation.metricHeading(metric,{year:2026,events:2,subject:'driver',session:'race'});
    assert.match(heading,/<h2>[^<]+<\/h2>/);
    assert.match(heading,/2 loaded GPs/);
    assert.match(heading,/2026/);
  }
  const unsafe=box.window.ApexPresentation.metricHeading('pace',{year:'<img onerror="bad">'});
  assert.doesNotMatch(unsafe,/<img/);
  assert.match(unsafe,/&lt;img/);
});

test('presentation changes reparent original observations without recalculating them',()=>{
  assert.match(ui,/split\.append\(charts\[0\], table\)/);
  assert.match(ui,/cell\.append\(chart\)/);
  assert.doesNotMatch(ui,/fetch\(|\.sort\(|\.innerHTML\s*=/);
  assert.match(ui,/table\.createCaption\(\)/);
  assert.doesNotMatch(ui,/measurement-table-heading|labelText\.textContent/);
  assert.match(car,/arrangePerformance\(root,activeMetric\)/);
  assert.match(car,/pace-visual-grid/);
});

test('layout assets ship, all categories are responsive, and focused telemetry is isolated',()=>{
  assert.doesNotThrow(()=>postcss.parse(css));
  assert.match(html,/href="styles\.css/);
  assert.match(html,/src="dashboard-ui\.js"/);
  const sync=readFileSync('scripts/sync-static.mjs','utf8');
  assert.match(sync,/"workspace-ui\.css"/);assert.match(sync,/"dashboard-ui\.js"/);
  assert.match(sync,/const browserRevision=browserHash/);
  assert.match(css,/\.performance-visual-grid[^{}]*\{[^}]*grid-template-columns: repeat\(2/);
  assert.match(css,/@media\(max-width:760px\)/);
  assert.match(css,/@layer focus[\s\S]*body:not\(\.trace-focus\)/);
  assert.match(css,/control-field:has\(#year\) \{ grid-area: 2 \/ 1;/);
  assert.match(css,/control-field:has\(#session\) \{ grid-area: 2 \/ 2;/);
  assert.match(css,/prefers-reduced-motion/);
  assert.match(html,/class="skip-link"/);
});

test('track scope directly exposes race choices without a second disclosure or automatic close',()=>{
  assert.doesNotMatch(html,/performanceToggleTracks|Choose races/);
  assert.doesNotMatch(ui,/setTrackTrayExpanded/);
  assert.match(car,/tray\.hidden = isSeason/);
  assert.match(html,/id="performanceTrackChoices" class="performance-track-choices"/);
  assert.match(html,/role="group" aria-label="Track selection"/);
});

test('hidden telemetry canvases are skipped before allocating or copying drawing buffers',()=>{
  const app=readFileSync('app.js','utf8');
  const start=app.indexOf('function drawRealChart(name)');
  const prefix=app.slice(start,app.indexOf('  const dpr =',start));
  assert.match(prefix,/rect\.width < 1 \|\| rect\.height < 1/);
  for(const rect of [{width:0,height:120},{width:300,height:0}]){
    const canvas={getBoundingClientRect:()=>rect};
    const layers=new WeakMap([[canvas,{old:true}]]);
    const box={document:{querySelector:()=>canvas},chartStaticLayers:layers};
    vm.createContext(box);vm.runInContext(prefix+'}',box);box.drawRealChart('Gear');
    assert.equal(layers.has(canvas),false);
    assert.equal(canvas.width,undefined);
  }
});
