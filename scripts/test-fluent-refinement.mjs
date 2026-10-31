import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const page=readFileSync('index.html','utf8'),css=readFileSync('workspace-ui.css','utf8'),source=readFileSync('car-performance.js','utf8');

test('primary navigation has only section controls and a stable fixed footprint',()=>{
  const header=page.slice(page.indexOf('<header class="site-header window-toolbar">'),page.indexOf('</header>'));
  const nav=header.slice(header.indexOf('<nav class="performance-tabs"'),header.indexOf('</nav>'));
  assert.equal((nav.match(/<button/g)||[]).length,2);
  assert.doesNotMatch(nav,/themeToggle|explanationsToggle|sidebarToggle/);
  // The unified toolbar carries the sidebar item and the trailing display tools, outside the view segment.
  assert.match(header,/id="windowSidebarToggle"[^>]+aria-controls="sessionSidebar performanceSidebar"/);
  assert.match(header,/class="workspace-tools"[\s\S]*id="explanationsToggle"[\s\S]*id="themeToggle"/);
  assert.doesNotMatch(header,/id="sidebarToggle"/);
  assert.match(page,/class="workspace-tools"/);
  assert.match(page,/rel="icon" href="assets\/f1apex-icon-32.png"/);assert.match(page,/class="brand-icon" src="assets\/f1apex-icon-64.png"/);
  assert.equal(readFileSync('assets/euv2-gauge.png').subarray(1,4).toString(),'PNG');
  assert.match(css,/\.header-actions \{ grid-column: 2; display: block; width: 340px;/);
  assert.match(css,/\.site-header \.performance-tabs button:active[^}]*transform: none/);
  assert.match(css,/\.workspace-tools :is\(#explanationsToggle,#glassToggle\) span, \.workspace-intro #sidebarToggle span \{ display: inline; position: static/);
});

test('run controls wrap without forced minimum widths and optional notes follow explanations',()=>{
  assert.match(css,/\.lap-workspace \.run-segments \{ display: grid;[^}]*overflow: visible/);
  assert.match(css,/\.lap-workspace \.run-segment \{[^}]*min-width: 0/);
  assert.match(css,/body.is-descriptions-hidden \.performance-source-note/);
  assert.match(css,/body.is-descriptions-hidden \.perf-regulatory-badge/);
  assert.match(css,/prefers-reduced-transparency/);
  assert.match(css,/forced-colors:active/);
});

test('short unfitted tyre runs retain lap inspection without inventing a fitted line',()=>{
  // tyreStintPlotModel gives src/components/TyreStintPlot.tsx its geometry.
  const plot=source.slice(source.indexOf('function tyreStintPlotModel('),source.indexOf('function tyreAgeView('));
  const box={finite:Number.isFinite,tyreCorrection:'raw',tyreFuelRate:.06,tyreShowExcluded:false,summarize:a=>a[0],fmt:(n,d,s='')=>Number.isFinite(n)?n.toFixed(d)+s:'—'};
  vm.createContext(box);vm.runInContext(plot,box);
  const model=box.tyreStintPlotModel({color:'#123456'},{driver:'AAA',event:'Test',stint:1,trendValue:null,points:[{lap:3,age:1,time:90},{lap:4,age:2,time:90.2}],excluded_points:[{lap:5,age:3,time:100,reason:'Slow lap'}]});
  assert.equal(model.laps.length,3);assert.equal(model.noTrend,true);assert.equal(model.curve,null,'no fitted line without a trend');
  assert.deepEqual([...model.laps].map(l=>l.lap),[3,4,5]);
  assert.ok(model.points.every(p=>Number.isFinite(p.cx)&&Number.isFinite(p.cy)));
  const selection=source.slice(source.indexOf('const plotRuns='),source.indexOf('let selectedRun=',source.indexOf('const plotRuns=')));
  assert.doesNotMatch(selection,/finite\(s.trendValue\)/);
});

test('development trend keeps its fit-sensitivity gate (sparkline: test-react-views.mjs)',()=>{
  assert.match(source,/const showSensitivity=trendView==='fitted'&&ordered.some/);
});
