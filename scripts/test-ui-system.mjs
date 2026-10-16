import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import postcss from 'postcss';
import {buildUiStyles,prepareStyle,UI_LAYERS,UI_STYLES} from '../lib/ui-style-build.mjs';
const read=file=>readFile(file,'utf8');

test('component appearance has one explicit final owner and focused canvas sizing stays first',async()=>{
  assert.deepEqual(UI_LAYERS,['focus','legacy','interface','workspace','appearance','components']);
  assert.deepEqual(UI_STYLES.at(-1),['ui-controls.css','components']);
  const source='button {color:red!important;min-height:28px!important} @layer focus {canvas {height:100%!important}} @media(forced-colors:active){button{color:ButtonText!important}}';
  const result=prepareStyle(source,'example.css');
  assert.equal(result.demoted,1);assert.match(result.css,/min-height:28px!important/);
  assert.doesNotMatch(result.css,/@layer focus/);assert.match(result.focus[0],/height:100%!important/);
  assert.match(result.css,/color:ButtonText!important/);
});

test('the actual shipped CSS is one parsed bundle without an import waterfall',async()=>{
  const built=await buildUiStyles(read),root=postcss.parse(built.css);
  assert.ok(built.retired>0);
  assert.doesNotMatch(built.css,/lap-selection-mark|speed-annotation-evidence|measurement-table-heading|trace-color-picker|track-tray-title/);
  assert.ok(built.demoted>20,'Legacy important appearance declarations must not silently win');
  assert.ok(built.css.lastIndexOf('@layer components')>built.css.lastIndexOf('@layer appearance'));
  let imports=0;root.walkAtRules('import',()=>imports++);assert.equal(imports,0);
  const page=await read('index.html');assert.equal((page.match(/rel="stylesheet"/g)||[]).length,1);
  assert.match(page,/ui-system.js/);
});

test('core light/dark labels and primary action text have normal-text contrast',async()=>{
  const css=postcss.parse(await read('ui-controls.css')),palettes=[];
  css.walkRules(rule=>{if([':root',':root[data-theme="light"]'].includes(rule.selector)){const values={};rule.walkDecls(d=>values[d.prop]=d.value);palettes.push(values);}});
  const luminance=hex=>{const n=hex.replace('#','');return [0,2,4].map(i=>parseInt(n.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);};
  const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
  const dark=palettes[0],light={...dark,...palettes[1]};
  for(const palette of [dark,light])for(const text of ['--ui-label','--ui-secondary','--ui-tertiary'])
    assert.ok(ratio(palette[text],palette['--ui-panel'])>=4.5,text+' must remain legible');
  assert.ok(ratio('#ffffff',dark['--ui-action'])>=4.5);
});

test('all interactive primitive families have explicit appearance and state contracts',async()=>{
  const css=await read('ui-controls.css'),script=await read('ui-system.js');
  for(const kind of ['primary','push','toolbar','sort','disclosure','picker','segment','tab','popup','menu-item','field','checkbox','radio','colour','list-row','choice','reference','icon','stepper']) {
    assert.ok(script.includes("'"+kind+"'"),kind);
    assert.ok(css.includes('data-ui-kind="'+kind+'"')||kind==='push',kind+' appearance');
  }
  assert.match(css,/:checked::after/);assert.match(css,/:indeterminate::after/);
  assert.match(css,/:focus-visible/);assert.match(css,/aria-invalid="true"/);
  for(const state of ['pointer:coarse','prefers-reduced-motion','prefers-reduced-transparency','prefers-contrast','forced-colors'])assert.ok(css.includes(state));
  assert.match(css,/min-height: 44px/);assert.doesNotMatch(css,/transform: scale/);
});

test('presentation decoration has no source requests, storage invalidation or score mutations',async()=>{
  const script=await read('ui-system.js');
  assert.doesNotMatch(script,/fetch\(|XMLHttpRequest|localStorage|telemetryCache|\.sort\(|gap_s\s*=/);
  assert.match(script,/attributeFilter:\['class','aria-pressed','aria-selected','disabled'\]/);
  assert.match(script,/requestAnimationFrame/);assert.match(script,/unowned/);
  assert.match(script,/window.enhanceSelect\(select\)/);
  assert.match(script,/handle\.setAttribute\('role','separator'\)/);
  assert.match(script,/ArrowLeft.*ArrowRight.*Home/);
  assert.match(script,/boundedColumnWidth/);
});

test('catalogue demonstrates mixed, disabled, loading and live light/dark states',async()=>{
  const page=await read('ui-catalog.html');
  for(const state of ['indeterminate=true','disabled','aria-busy="true"','data-theme="dark"','catalogTheme','role="alert"'])assert.ok(page.includes(state),state);
  assert.match(page,/ui-system.js/);assert.match(page,/href="styles.css"/);
  assert.doesNotMatch(page,/fetch\(|app.js|car-performance.js/);
});
