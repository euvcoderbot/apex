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

test('each control family has one selected style and rings mean focus only (selection spec)',()=>{
  assert.doesNotMatch(app,/driver-selection-mark|hideDrivers|#sidebarToggle/);
  assert.doesNotMatch(read('index.html'),/id="sidebarToggle"|Hide drivers/);
  const sheet=postcss.parse(css);
  const family={
    list:{background:'var(--ui-list-selected)',selectors:['#driverPills .driver-pill[aria-pressed="true"]','.app-sidebar .track-pill[aria-pressed="true"]','.select-menu button[aria-selected="true"]','button[data-ui-kind="menu-item"][aria-selected="true"]']},
    segment:{background:'var(--ui-seg-thumb)',selectors:['.lap-workspace .run-segment[data-ui-kind="run"][aria-pressed="true"]','.category-bar .category-tab[aria-current="page"]']},
    tile:{background:'var(--ui-tile-on)',selectors:['.lap-workspace .lap-chip[aria-pressed="true"]','.circuit-section-group .corner-picker button.corner-pick[aria-pressed="true"]','button[data-ui-kind="choice"][aria-pressed="true"]','#compareAllFastest[aria-pressed="true"]']},
  };
  for(const [name,{background,selectors}] of Object.entries(family))for(const selector of selectors){
    const rules=sheet.nodes.filter(node=>node.type==='rule'&&node.selectors.includes(selector)&&node.nodes.some(d=>d.prop==='background'));
    assert.ok(rules.length,selector);
    for(const rule of rules)assert.ok(rule.nodes.some(d=>d.prop==='background'&&d.value===background),`${name}: ${selector}`);
  }
  // No inset ring shows selection; team colour never tints a selected control.
  assert.doesNotMatch(css,/ui-choice-ring|ui-choice-selected/);
  sheet.walkRules(rule=>{if(/aria-pressed="true"|aria-selected="true"|aria-current="page"/.test(rule.selector.replace(/:not\([^)]*\)/g,''))&&!rule.parent?.params?.includes('contrast')&&!rule.parent?.params?.includes('forced-colors'))
    rule.walkDecls(d=>{assert.doesNotMatch(d.value,/var\(--team\)/,rule.selector);if(d.prop==='box-shadow')assert.doesNotMatch(d.value,/^inset 0 0 0/,rule.selector);});});
  assert.match(css,/\.lap-workspace \.run-segment \.run-choice-indicator \{ display: none; \}/);
  assert.match(css,/#loadedLaps \.loaded-lap-pill\.reference::before \{ background: color-mix\(in srgb,var\(--ui-accent\) 20%,transparent\); color: var\(--ui-accent\); \}/);
  assert.match(css,/\.loaded-lap-pill\.reference \{ background: var\(--ui-control\)/);
  // Driver list as a source list: one 32 px line, natural-case name, trailing code and check.
  assert.match(css,/#driverPills \.driver-pill\[data-ui-kind="list-row"\] \{ grid-template-columns: 20px 18px minmax\(0,1fr\) auto 12px;[^}]*height: 32px/);
  assert.match(css,/#driverPills \.driver-pill\[data-ui-kind="list-row"\]::before \{ content: none; \}/);
  assert.match(app,/<span class="driver-pill-identity">\$\{escapeUI\(name\)\}<\/span>\$\{isRace \? raceResultMarkup\(realDrivers\.get\(code\)\) : `<span class="driver-pill-code">/);
  const box={};vm.createContext(box);vm.runInContext(app.slice(app.indexOf('function naturalDriverName('),app.indexOf('function renderDrivers(')),box);
  assert.equal(box.naturalDriverName('Max VERSTAPPEN'),'Max Verstappen');
  assert.equal(box.naturalDriverName('Andrea Kimi ANTONELLI'),'Andrea Kimi Antonelli');
  assert.equal(box.naturalDriverName('Nico HÜLKENBERG'),'Nico Hülkenberg');
  assert.equal(box.naturalDriverName('VER'),'VER','a code fallback is not recased');
});

test('paired chart and table use matching insets and the tallest evidence row',()=>{
  assert.match(css,/\.performance-split-view > :is\(\.performance-chart-card,\.performance-table-wrap\) \{ padding: 8px; \}/);
  assert.match(css,/\.performance-split-view\.is-row-synced \.performance-table tbody tr \{ height: var\(--split-row\); \}/);
  const ui=read('dashboard-ui.js');
  assert.match(ui,/Math\.ceil\(Math\.max\(0,\.\.\.rows\.map\(row=>row\.getBoundingClientRect\(\)\.height\)\)\)/);
});

test('narrow session lists never hide the only driver identity in race rows',()=>{
  const sheet=postcss.parse(css);
  const media=sheet.nodes.filter(n=>n.type==='atrule'&&n.name==='media'&&n.params==='(max-width:560px)').at(-1);
  assert.ok(media);
  const rule=selector=>media.nodes.find(n=>n.type==='rule'&&n.selectors.includes(selector));
  assert.ok(rule('#driverSidebar #driverPills').nodes.some(d=>d.prop==='grid-template-columns'&&d.value==='minmax(0,1fr)'));
  assert.ok(rule('#driverPills .driver-pill-identity').nodes.some(d=>d.prop==='display'&&d.value==='block'));
  assert.ok(rule('#driverPills.has-race-results .driver-pill[data-ui-kind="list-row"]').nodes.some(d=>d.prop==='grid-template-columns'&&d.value==='16px 18px minmax(0,1fr) auto'));
});
