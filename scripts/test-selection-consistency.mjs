import {appSource} from './app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import postcss from 'postcss';

const read=file=>readFileSync(file,'utf8').replace(/\r\n/g,'\n');
const app=appSource(), css=read('macos-window.css');

test('corner selection updates the same buttons without moving focus or rebuilding the picker',()=>{
  const buttons=Array.from({length:5},(_,index)=>({
    dataset:{cornerIndex:String(index)},title:`T${index+1} · fastest VER`,pressed:false,
    classList:{toggle(name,value){this[name]=value;}},
    setAttribute(name,value){if(name==='aria-pressed')this.pressed=value==='true';},
    focus(){throw new Error('Selection-only updates must not move focus');}
  }));
  let replacements=0;
  const root={set innerHTML(value){replacements++;},contains:el=>buttons.includes(el),querySelectorAll:()=>buttons};
  const document={activeElement:buttons[4]};
  const cache=new WeakMap([[root,'same picker']]);
  const box={cornerPickerMarkup:cache,document};vm.createContext(box);
  vm.runInContext(app.slice(app.indexOf('function updateCornerPicker('),app.indexOf('function apiUrl(')),box);
  for(const indices of [[1],[1,2],[1,2,3,4],[1,3,4],[1,3],[]]){
    box.updateCornerPicker(root,'same picker',new Set(indices),new Set());
    assert.deepEqual(buttons.flatMap((button,index)=>button.pressed?[index]:[]),indices);
    assert.deepEqual(buttons.flatMap((button,index)=>button.classList.selected?[index]:[]),indices);
    assert.equal(document.activeElement,buttons[4]);
  }
  assert.equal(replacements,0);
  box.updateCornerPicker(root,'same picker',new Set([4]),new Set([4]));
  assert.match(buttons[4].title,/automatically included link$/);
  box.updateCornerPicker(root,'same picker',new Set(),new Set());
  assert.doesNotMatch(buttons[4].title,/automatically included/);
  assert.doesNotMatch(app,/positionCornerIndicator|pickerState|is-multiple/);
  assert.match(css,/\.telemetry-analysis-grid > #cornerAnalysis \{ position: static; top: auto;/);
});

test('driver, race, run, lap and corner selected states share a fill and outline, not selection marks',()=>{
  assert.doesNotMatch(app,/driver-selection-mark|hideDrivers|#sidebarToggle/);
  assert.doesNotMatch(read('index.html'),/id="sidebarToggle"|Hide drivers/);
  const sheet=postcss.parse(css);
  const selectors=['#driverPills .driver-pill[aria-pressed="true"]',
    '.app-sidebar .track-pill[aria-pressed="true"]',
    '.lap-workspace .run-segment[data-ui-kind="run"][aria-pressed="true"]',
    '.lap-workspace .lap-chip[aria-pressed="true"]',
    '.circuit-section-group .corner-picker button.corner-pick[aria-pressed="true"]'];
  for(const selector of selectors){
    const rules=sheet.nodes.filter(node=>node.type==='rule'&&node.selectors.includes(selector));
    assert.ok(rules.length,selector);
    for(const rule of rules){
      assert.ok(rule.nodes.some(d=>d.prop==='background'&&d.value==='var(--ui-choice-selected)'),selector);
      assert.ok(rule.nodes.some(d=>d.prop==='box-shadow'&&d.value==='var(--ui-choice-ring)'),selector);
    }
  }
  assert.match(css,/#driverPills \.driver-pill\[data-ui-kind="list-row"\]::before \{ content: none; \}/);
  assert.match(css,/#driverPills\.has-race-results[^}]*grid-template-columns: 18px 22px minmax\(0,1fr\) auto/);
});

test('paired chart and table use matching insets and the tallest evidence row',()=>{
  assert.match(css,/\.performance-split-view > :is\(\.performance-chart-card,\.performance-table-wrap\) \{ padding: 8px; \}/);
  assert.match(css,/\.performance-split-view\.is-row-synced \.performance-table tbody tr \{ height: var\(--split-row\); \}/);
  const ui=read('dashboard-ui.js');
  assert.match(ui,/Math\.ceil\(Math\.max\(0,\.\.\.rows\.map\(row=>row\.getBoundingClientRect\(\)\.height\)\)\)/);
});
