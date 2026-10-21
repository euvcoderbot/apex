import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import postcss from 'postcss';
// Normalise Windows checkouts (CRLF) so source-pattern assertions match.
const read=f=>readFileSync(f,'utf8').replace(/\r\n/g,'\n');
const page=read('index.html'),css=read('macos-window.css'),ui=read('dashboard-ui.js'),system=read('ui-system.js'),tokens=read('ui-controls.css');

test('window uses a unified toolbar, a sidebar for setup and a category bar in the main pane',()=>{
  const header=page.slice(page.indexOf('<header class="site-header window-toolbar">'),page.indexOf('</header>'));
  assert.match(header,/class="toolbar-leading"[\s\S]*id="windowSidebarToggle"[\s\S]*class="window-title"/);
  assert.match(header,/<nav class="performance-tabs"/);
  assert.match(page,/<aside class="app-sidebar" id="sessionSidebar"[^>]*>\s*<section class="dashboard-card session-controls"/);
  assert.match(page,/<aside class="app-sidebar" id="performanceSidebar"[\s\S]*class="dashboard-card session-controls performance-controls"/);
  // Categories live in the main pane, directly above the results, not low in the sidebar.
  const sidebar=page.slice(page.indexOf('id="performanceSidebar"'),page.indexOf('</aside>',page.indexOf('id="performanceSidebar"')));
  assert.doesNotMatch(sidebar,/performanceCategoryList/);
  assert.match(page,/<nav class="category-bar" id="performanceCategoryList"[^>]*hidden><\/nav>\s*<div id="performanceResults">/);
  assert.match(system,/\.category-tab'\)\)return 'tab'/);assert.match(system,/#windowSidebarToggle'\)\)return 'toolbar'/);
});

test('appearance follows the system until the person picks one',()=>{
  assert.match(page,/localStorage\.getItem\('apex-theme'\) \|\| \(matchMedia\('\(prefers-color-scheme: light\)'\)\.matches \? 'light' : 'dark'\)/);
  assert.match(page,/name="color-scheme" content="light dark"/);
  assert.match(ui,/prefers-color-scheme: light[\s\S]*if\(stored\)return/);
});

test('category bar mirrors the original tablist and delegates activation to it',()=>{
  assert.match(ui,/\.performance-mode \[data-performance-metric\]/);
  assert.match(ui,/\.performance-mode \[data-performance-metric="\$\{CSS\.escape\(row\.dataset\.sidebarMetric\)\}"\]`\)\?\.click\(\)/);
  assert.match(ui,/setAttribute\('aria-current','page'\)/);
  assert.match(ui,/ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'/);
  assert.doesNotMatch(ui,/\.innerHTML\s*=/);
  // The original tab strip stays the state owner; only its presentation is hidden on wide windows.
  assert.match(css,/^#performanceResults > \.performance-toolbar > \.performance-mode \{ display: none; \}/m);
});

test('sidebar toggle and source list behave in a minimal DOM',()=>{
  const listeners={},classes=new Set(),attrs={};
  const button={setAttribute:(k,v)=>attrs[k]=v,addEventListener:(type,fn)=>listeners[type]=fn,title:''};
  const asides=[{inert:false},{inert:false}];
  const body={classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name),contains:name=>classes.has(name)},dataset:{}};
  const prefs={};
  const box={Event:class{constructor(type){this.type=type;}},window:{matchMedia:()=>({matches:true,addEventListener(){}}),dispatchEvent(){},ApexAnalysis:{preference:(k,d)=>k in prefs?prefs[k]:d,savePreference:(k,v)=>prefs[k]=v}},
    document:{body,querySelector:s=>s==='#windowSidebarToggle'?button:null,querySelectorAll:s=>s==='.app-sidebar'?asides:[]}};
  vm.createContext(box);vm.runInContext(ui,box);
  assert.equal(attrs['aria-expanded'],'true');assert.equal(classes.has('is-sidebar-hidden'),false);
  listeners.click();
  assert.equal(classes.has('is-sidebar-hidden'),true);assert.equal(attrs['aria-expanded'],'false');assert.equal(attrs['aria-label'],'Show sidebar');
  assert.ok(asides.every(aside=>aside.inert));assert.equal(prefs.hideSidebar,true);
  listeners.click();
  assert.equal(classes.has('is-sidebar-hidden'),false);assert.ok(asides.every(aside=>!aside.inert));
});

test('window layer is parsed, final, and keeps accessibility fallbacks',()=>{
  postcss.parse(css);
  for(const query of ['prefers-reduced-transparency','prefers-contrast:more','prefers-reduced-motion','forced-colors','pointer:coarse','max-width:979px','max-width:700px'])assert.ok(css.includes(query),query);
  assert.match(css,/\.app-sidebar \{[^}]*grid-row: 1 \/ -1/);
  assert.match(css,/body\.is-sidebar-hidden > :is\(main#top,#carPerformance\) \{ grid-template-columns: 0 minmax\(0,1fr\); \}/);
  assert.match(css,/\.select-trigger i \{[^}]*m1\.5 4\.8 3-3 3 3m-6 3\.4 3 3 3-3/,'pop-up buttons carry paired chevrons');
  assert.doesNotMatch(css,/#performanceMetricPanel[^{]*\{[^}]*animation/,'re-rendered panels must not re-animate on every progress update');
});

test('review fixes: readable sidebar, paired lap cards, single trace toolbar and quiet status text',()=>{
  assert.doesNotMatch(css,/zoom:\s*1\.1/);assert.match(tokens,/--ui-sidebar-width: 282px/);
  assert.match(css,/\.app-sidebar #driverSidebar \{ align-self: stretch;/,'driver list must use the full sidebar width');
  assert.match(css,/\.app-sidebar \.track-tray-header \{ grid-template-columns: minmax\(0,1fr\)/,'race actions must use the full sidebar width');
  assert.match(css,/\.sector-cards \{ display: grid; grid-template-columns: repeat\(auto-fill,minmax\(min\(100%,360px\),1fr\)\)/);
  assert.match(css,/\.trace-focus-close,\.chart-heading \.trace-focus-close\[data-ui-kind="push"\] \{ display: none; \}/);
  assert.match(css,/body\.trace-focus \.trace-focus-close/);
  assert.match(css,/body\.is-descriptions-hidden #carPerformance > \.performance-status-card:not\(\.is-running\) \{ display: none; \}/);
  assert.match(css,/body\.is-descriptions-hidden #performanceMetricPanel p\.performance-quality-status:not\(:has\(button\)\):not\(details p\)/);
  assert.match(css,/\.category-bar \.category-tab span \{ line-height: 1\.3; \}/,'descenders must not clip');
});

test('fit pass: toolbar labels, lap lists and range choices never clip or overflow',()=>{
  assert.match(css,/\.trace-tools button\.trace-reset\[data-ui-kind="stepper"\][^{]*\{ width: auto; min-width: max-content;/,'Reset must not be squeezed into a 24px stepper');
  assert.match(css,/#lapWorkspace \.run-toolbar \{ display: flex; flex-wrap: wrap;/);
  assert.match(css,/\.lap-workspace \.lap-grid \{ max-height: none; overflow: visible; \}/);
  assert.match(css,/\.lap-grid:has\(> \.lap-chip:nth-child\(25\)\) \{ max-height: 440px; overflow-y: auto; \}/);
  assert.match(css,/\.performance-range-options\[data-ui-group="segments"\] \{ display: grid; grid-template-columns: repeat\(auto-fill,minmax\(56px,1fr\)\)/);
  assert.match(css,/@media\(min-width:1001px\) and \(max-width:1280px\)/);
});

test('browser-owned scale keeps breakpoints and pointer maths in layout px',async()=>{
  const {scaleMediaParams,UI_ZOOM,buildUiStyles}=await import('../lib/ui-style-build.mjs');
  assert.equal(UI_ZOOM,1);
  assert.equal(scaleMediaParams('(max-width:979px) and (min-width:500px)'),'(max-width:979px) and (min-width:500px)');
  assert.equal(scaleMediaParams('(prefers-reduced-motion:reduce)'),'(prefers-reduced-motion:reduce)');
  assert.doesNotMatch(css,/html\s*\{\s*zoom:/);
  const built=(await buildUiStyles(f=>readFileSync(f,'utf8'))).css;
  assert.match(built,/@media\(max-width:979px\)/);
  assert.match(page,/window\.APEX_UI_ZOOM = 1;/);
  assert.match(ui,/980\*\(window\.APEX_UI_ZOOM\|\|1\)/);
  const app=read('app.js');
  assert.match(app,/const dx = old \? \(old\.rect\.left - next\.left\) \/ pageZoom : 0;/);
  assert.match(app,/innerWidth - tipRect\.width - 12\)\) \/ pageZoom\}px/);
});

test('coverage notes collect once per card, empty charts explain themselves, paired rows line up',()=>{
  assert.match(ui,/const parent=note\.closest\('\.performance-card-body'\)\|\|note\.parentElement;/);
  assert.match(ui,/chart\.classList\.toggle\('is-empty-chart',empty\)/);
  assert.match(ui,/split\.style\.setProperty\('--split-row',rowHeight\+'px'\)/);
  assert.match(ui,/Math\.ceil\(Math\.max\(0,\.\.\.rows\.map\(row=>row\.getBoundingClientRect\(\)\.height\)\)\)/);
  assert.match(css,/\.performance-split-view :is\(\.performance-bar-row,\.performance-tyre-age-row\) \{ box-sizing: border-box; height: var\(--split-row\);/);
  assert.match(css,/@container perfcard \(max-width: 980px\) \{\n  \.performance-card-body > \.performance-split-view \{ grid-template-columns: minmax\(0,1fr\); \}/);
  assert.match(css,/\.performance-visual-grid:not\(:has\(\.performance-chart-controls:not\(\[aria-hidden="true"\]\)\)\) \.performance-chart-controls \{ display: none; \}/);
  assert.match(css,/\.performance-table td small \{ display: block; white-space: nowrap;/);
});

test('official team marks ship in colour, black and white at 96px and switch by appearance',()=>{
  const app=read('app.js');
  for(const team of ['alpine','astonmartin','audi','cadillac','ferrari','haasf1team','mclaren','mercedes','racingbulls','redbullracing','williams'])
    for(const suffix of ['','-color','-black'])assert.ok(readFileSync(`assets/teams/official/${team}${suffix}.webp`).length>200,team+suffix);
  assert.match(app,/class="team-logo-color" src="assets\/teams\/official\/\$\{base\}-color\.webp"/);
  assert.match(css,/:root:not\(\[data-theme="light"\]\) \.team-logo-official:is\(\[data-team-mark="astonmartin"\],\[data-team-mark="audi"\],\[data-team-mark="cadillac"\],\[data-team-mark="mercedes"\]\) > \.team-logo-color \{ display: none; \}/);
  assert.match(css,/\.team-logo-official > img \{[^}]*filter: none;/,'colour marks must not be inverted in light mode');
});

test('lap cards: centred sector cells, fixed delta slots, sectors right of the identity',()=>{
  assert.match(css,/\.sector-cards \.lap-summary-card \.sector-cell-value \{ display: flex; flex-direction: column; align-items: center;/);
  assert.match(css,/\.sector-cards \.lap-summary-card \.sector-delta-slot,\.sector-cards \.lap-summary-card \.sector-delta-slot:empty \{ order: 1; display: flex;[^}]*height: 18px;/);
  assert.match(css,/@container sectorcards \(min-width: 700px\) \{\n  \.sector-cards \.lap-summary-card \{ grid-template-columns: auto minmax\(0,1fr\);/);
  assert.match(css,/\.select-menu button\[aria-selected="true"\]::before,\.select-menu button\[data-ui-kind="menu-item"\]\[aria-selected="true"\]::before \{ content: none; display: none; \}/);
  assert.match(read('app.js'),/menu\.style\.top = top \/ zoom \+ 'px';/);
});

test('sidebar text and accent links stay legible on the sidebar material in both appearances',()=>{
  const root=postcss.parse(tokens),palettes=[];
  root.walkRules(rule=>{if([':root',':root[data-theme="light"]'].includes(rule.selector)&&rule.parent.type==='root'){const values={};rule.walkDecls(d=>values[d.prop]=d.value);palettes.push(values);}});
  const luminance=hex=>{const n=hex.replace('#','');return [0,2,4].map(i=>parseInt(n.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);};
  const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
  const dark=palettes[0],light={...dark,...palettes[1]};
  for(const palette of [dark,light])for(const text of ['--ui-label','--ui-secondary','--ui-tertiary','--ui-accent'])
    for(const surface of ['--ui-sidebar','--ui-panel','--ui-canvas'])assert.ok(ratio(palette[text],palette[surface])>=4.5,`${text} on ${surface}`);
});
