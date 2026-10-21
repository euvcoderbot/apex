import {appSource} from './app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import postcss from 'postcss';
const css=fs.readFileSync('macos-ui.css','utf8');
const app=appSource();
test('one current macOS appearance layer ships after the workspace and replaces Windows styling',()=>{
  postcss.parse(css);
  const page=fs.readFileSync('index.html','utf8'),sync=fs.readFileSync('scripts/sync-static.mjs','utf8');
  assert.equal((page.match(/rel="stylesheet"/g)||[]).length,1);
  const order=fs.readFileSync('lib/ui-style-build.mjs','utf8');
  assert.ok(order.indexOf("['macos-ui.css'")>order.indexOf("['workspace-ui.css'"));
  assert.ok(order.indexOf("['ui-controls.css'")>order.indexOf("['macos-ui.css'"));
  assert.doesNotMatch(page,/fluent-ui/);assert.doesNotMatch(sync,/fluent-ui/);
  assert.match(css,/-apple-system, BlinkMacSystemFont/);
  assert.doesNotMatch(css,/Segoe|Mica|acrylic/i);
  assert.match(css,/\.performance-controls button#performanceLoad \{/);
});
test('every interactive family and every data presentation shares the new appearance',()=>{
  for(const name of ['site-header','performance-tabs','select-trigger','select-menu','driver-pill','tire-option','run-segment','lap-chip','loaded-lap-pill','race-result-controls','corner-picker','map-view-switch','chart','trace-setting','trace-zoom-cluster','tooltip','app-toast','lap-summary-card','summary-sectors','summary-conditions','performance-mode','performance-card','performance-chart-card','performance-bar-track','performance-table','track-pill','performance-tyre-plot-controls','performance-pit-controls','trend-sparkline','retirement-badge','section-empty','performance-error'])assert.ok(css.includes('.'+name),name);
  assert.match(css,/input\[type="checkbox"\]/);assert.match(css,/input\[type="search"\]/);
  assert.match(css,/scrollbar-thumb/);assert.match(css,/progress \{/);assert.match(css,/summary \{/);
});
test('motion, contrast, transparency and touch alternatives remain explicit',()=>{
  for(const media of ['prefers-reduced-motion','prefers-reduced-transparency','prefers-contrast','forced-colors','pointer:coarse'])assert.ok(css.includes(media),media);
  assert.match(css,/:focus-visible/);assert.match(css,/:disabled/);assert.match(css,/:active/);
  assert.match(css,/min-height: 44px/);
  assert.match(css,/\.dashboard-card,.telemetry-card,.performance-card,.chart \{ animation: none/);
  assert.doesNotMatch(app,/installGlassMotion|--glass-x|--glass-y/);
});
test('compact lap summary keeps all sectors and all weather fields without hiding their values',()=>{
  const renderer=app.slice(app.indexOf('function renderSectors('),app.indexOf('// Chart Constants'));
  for(const value of ['air_temperature','track_temperature','wind_speed','rainfall','summary-sectors','summary-lap-time','tyre_life'])assert.ok(renderer.includes(value),value);
  assert.match(css,/summary-lap-time \{ grid-area: 1 \/ 2 \/ 3 \/ 3/);
  assert.match(css,/summary-conditions \{ display: flex; flex-wrap: wrap/);
  assert.match(css,/summary-condition \{[^}]*width: auto/);
  assert.match(css,/sector-delta-slot \{[^}]*height: 20px; min-height: 20px/);
});
test('popup keyboard typeahead cycles displayed enabled choices and Escape returns focus',()=>{
  const start=app.indexOf("  let searchPrefix = '', lastSearchAt = 0;");
  const end=app.indexOf("  trigger.addEventListener('keydown'",start);
  let listener,focused=-1,closed=0;
  const items=['Bahrain Grand Prix','British Grand Prix','Singapore Grand Prix'].map((textContent,i)=>({textContent,focus(){focused=i;box.document.activeElement=this;}}));
  const box={Date,document:{activeElement:items[0]},menu:{querySelectorAll(selector){assert.match(selector,/:not\(:disabled\)/);return items;},addEventListener(_name,fn){listener=fn;}},close(){closed++;},trigger:{focus(){focused=-2;}}};
  vm.createContext(box);vm.runInContext(app.slice(start,end),box);
  function press(key){listener({key,preventDefault(){}});}
  press('s');assert.equal(focused,2);press('b');assert.equal(focused,0);press('b');assert.equal(focused,1);
  press('Home');assert.equal(focused,0);press('End');assert.equal(focused,2);
  press('Escape');assert.equal(closed,1);assert.equal(focused,-2);
  assert.match(app,/role="option" tabindex="-1"/);
  assert.match(app,/select\.options\[optionIndex\]\.disabled/);
});
