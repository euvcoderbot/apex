import {appSource} from './app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import postcss from 'postcss';
const app=appSource(),css=readFileSync('ui-controls.css','utf8'),car=readFileSync('car-performance.js','utf8');

test('rendered lap and sector differences precede their measured times, with weather icons',()=>{
  const laps=[{code:'HAM',lap:21,time:91.496,real:{s1:27.273,s2:38.258,s3:25.965,compound:'SOFT'}},{code:'VER',lap:11,time:91.373,real:{s1:27.002,s2:38.531,s3:25.840,compound:'SOFT'}}];
  let html='';const root={querySelectorAll:()=>[]};
  const box={loaded:laps,drivers:[],realDrivers:new Map(laps.map(l=>[l.code,{laps:[l.real]}])),nominatedCompounds:[],teamLogoMarkup:()=>'<i class="team-logo"></i>',
    $:()=>root,replaceUI:(r,value)=>{html=value;},getLapColor:()=> '#4781d7',getCompoundCode:()=> 'SOFT (C5)',getCompoundToneClass:()=> 'soft',tyreImageMarkup:()=> '',compoundBadgeMarkup:c=>`<svg class="compound-badge" data-c="${c}"></svg>`,time:t=>t.toFixed(3)};
  vm.createContext(box);vm.runInContext(app.slice(app.indexOf('function renderSectors()'),app.indexOf('// Chart Constants and Configuration')),box);box.renderSectors();
  const second=html.slice(html.indexOf('data-motion-key="summary-VER'));
  assert.match(second,/summary-lap-time[\s\S]*?−0\.123s<\/em><strong>91\.373<\/strong>/);
  assert.match(second,/sector-delta-slot[\s\S]*?−0\.271s<\/em><\/span><strong>27\.002s<\/strong>/);
  for(const icon of ['🌤️','🌡️','🚩','🌧️'])assert.ok(html.includes(`<i aria-hidden="true">${icon}</i>`));
  assert.doesNotMatch(html,/<small>L21<\/small>/);
  // The lap card uses the same compound badge as the lap tiles, not the tyre photo.
  assert.match(html,/summary-tyre[^"]*"><svg class="compound-badge" data-c="SOFT">/);
});

test('lap chooser uses an unscrolled driver grid above its lap cards',()=>{
  postcss.parse(css);
  assert.match(css,/#lapSelectionBody > #driverSidebar \{ grid-area: 1 \/ 1/);
  assert.match(css,/#lapSelectionBody > #stintPanels \{ grid-area: 2 \/ 1/);
  assert.match(css,/@media\(max-width:760px\)[\s\S]*#lapSelectionBody > #stintPanels \{ grid-area: 2 \/ 1/);
  assert.match(css,/sector-cell::after \{ height: 5px/);
  assert.match(css,/sector-cell-value > small \{ font-size: var\(--type-headline\)/);
});

test('trace selectors show exact lap times while retaining stable lap identities',()=>{
  const source=app.slice(app.indexOf('function renderTraceVisibilityControls()'),app.indexOf('function syncTraceVisibilityControls()'));
  assert.match(source,/Number\.isFinite\(lap\.real\?\.display_time\)/);
  assert.match(source,/<b>\$\{lap.code\}<\/b><small>\$\{lapLabel\}<\/small>/);
  assert.match(source,/data-trace-key="\$\{key\}"/);
  assert.match(source,/disableLast/);
});

test('compound pills keep all options and the selected compound',()=>{
  // CompoundControl in src/views/TyresView.tsx (rendered in test-react-views.mjs).
  const tyres=readFileSync('src/views/TyresView.tsx','utf8');
  assert.match(tyres,/data-tyre-compound=\{c\} aria-pressed=\{compound\.value === c\}/);
  assert.match(tyres,/aria-labelledby="performanceTyreCompoundLabel"/);
  assert.match(car,/const navEmoji=\{pace:'⏱️'/);
  assert.match(css,/performance-tyre-toolbar \.performance-quality-status \{ flex: 1 0 100%/);
});
