import {appSource} from './app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=f=>readFileSync(f,'utf8'),css=read('ui-controls.css'),ui=read('ui-system.js'),layout=read('dashboard-ui.js');

test('richer run choices are not forced into the regular thirty-pixel segment contract',()=>{
  assert.doesNotMatch(ui.match(/const groups=[^;]+/)[0],/run-segments/);
  assert.match(ui,/el\.matches\('\.run-segment'\)\)return 'run'/);
  assert.match(css,/grid-template-columns: repeat\(var\(--run-count,3\),minmax\(0,1fr\)\)/);
  assert.match(css,/run-segment\[data-ui-kind="run"\][^}]*min-height: 38px; height: auto/);
  assert.match(appSource(),/class="run-segments"[^\n]*style="--run-count:/);
});

test('wide driver rail reuses the same node and keeps compact windows in the chooser',()=>{
  // 980 px at 100%, scaled with the 110% interface zoom.
  assert.match(layout,/matchMedia\(`\(min-width:\$\{Math\.round\(980\*\(window\.APEX_UI_ZOOM\|\|1\)\)\}px\)`\)/);
  assert.match(layout,/column=document\.querySelector\('#sessionSidebar'\)/);
  assert.match(layout,/host=wide\?column:body/);
  assert.match(layout,/sidebar.parentElement!==host\)wide\?host.append\(sidebar\):host.prepend\(sidebar\)/);
  assert.match(css,/has-driver-rail #driverPills \{ grid-template-columns: minmax\(0,1fr\); max-height: none; overflow: visible/);
  assert.doesNotMatch(layout,/#sidebarToggle/);
  assert.doesNotMatch(appSource(),/#sidebarToggle/);
});

test('lap and sector readings have a real divider in both layout orientations',()=>{
  assert.match(css,/summary-sectors[^}]*border-left: 1px solid var\(--ui-border-strong\)/);
  assert.match(css,/summary-sectors \{ border-left: 0;[^}]*border-top: 1px solid var\(--ui-border-strong\)/);
});
