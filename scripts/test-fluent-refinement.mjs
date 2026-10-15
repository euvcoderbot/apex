import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const page=readFileSync('index.html','utf8'),css=readFileSync('workspace-ui.css','utf8'),source=readFileSync('car-performance.js','utf8');

test('primary navigation has only section controls and a stable fixed footprint',()=>{
  const header=page.slice(page.indexOf('<header class="site-header">'),page.indexOf('</header>'));
  assert.equal((header.match(/<button/g)||[]).length,2);
  assert.doesNotMatch(header,/themeToggle|explanationsToggle|sidebarToggle/);
  assert.match(page,/class="workspace-tools"/);
  assert.match(page,/rel="icon" href="assets\/euv2-icon-32.png"/);
  assert.equal(readFileSync('assets/euv2-gauge.png').subarray(1,4).toString(),'PNG');
  assert.match(css,/\.header-actions \{ grid-column: 2; display: block; width: 340px;/);
  assert.match(css,/\.site-header \.performance-tabs button:active[^}]*transform: none/);
  assert.match(css,/\.workspace-tools #explanationsToggle span, \.workspace-intro #sidebarToggle span \{ display: inline; position: static/);
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
  const plot=source.slice(source.indexOf('function renderTyreStintPlot('),source.indexOf('function renderTyreAge('));
  const box={finite:Number.isFinite,tyreCorrection:'raw',tyreFuelRate:.06,tyreShowExcluded:false,
    summarize:a=>a[0],color:v=>v,escape:v=>String(v),fmt:(n,d,s='')=>Number.isFinite(n)?n.toFixed(d)+s:'—',
    table:(headers,rows)=>JSON.stringify({headers,rows})};
  vm.createContext(box);vm.runInContext(plot,box);
  const html=box.renderTyreStintPlot({color:'#123456'},{driver:'AAA',event:'Test',stint:1,trendValue:null,points:[{lap:3,age:1,time:90},{lap:4,age:2,time:90.2}],excluded_points:[{lap:5,age:3,time:100,reason:'Slow lap'}]});
  assert.match(html,/3 recorded laps/);assert.match(html,/not enough data for a trend/);
  assert.doesNotMatch(html,/NaN|Infinity|stroke-dasharray="6 4"/);
  assert.match(html,/L3/);assert.match(html,/L4/);assert.match(html,/L5/);
  const selection=source.slice(source.indexOf('const plotRuns='),source.indexOf('let selectedRun=',source.indexOf('const plotRuns=')));
  assert.doesNotMatch(selection,/finite\(s.trendValue\)/);
});

test('development sparklines show real rounds and never join unobserved gaps',()=>{
  const plot=source.slice(source.indexOf('function trendSparkline('),source.indexOf('function renderTrend('));
  const box={events:[{round:16},{round:18}],finite:Number.isFinite,color:v=>v,escape:v=>String(v),fmt:n=>n.toFixed(3)};
  vm.createContext(box);vm.runInContext(plot,box);
  const team={team:'Example',color:'#123456',q:[{round:16,pace:1,event:'A'},{round:18,pace:.5,event:'B'}]};
  const html=box.trendSparkline(team,[team]);
  assert.equal((html.match(/<circle/g)||[]).length,2);
  assert.match(html,/common scale across teams/);
  assert.match(html,/d="M[^"L]+ M/);
  assert.match(source,/const showSensitivity=trendView==='fitted'&&ordered.some/);
});
