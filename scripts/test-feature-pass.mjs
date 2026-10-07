import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {normalizeDataPath} from '../lib/data-cache.mjs';
const coreSource=readFileSync('analysis-core.js','utf8');
const app=readFileSync('app.js','utf8'),alignment=readFileSync('alignment.js','utf8'),car=readFileSync('car-performance.js','utf8');
const core=()=>{const context={};vm.createContext(context);vm.runInContext(coreSource,context);return context.ApexAnalysis;};

test('shared formatter uses three decimals without turning missing data into zero',()=>{
  const c=core();assert.equal(c.format(null),'—');assert.equal(c.format(.102,' s',3,true),'+0.102 s');
  assert.equal(c.format(-.00001,' s',3,true),'0.000 s');assert.equal(c.format(Infinity),'—');
});
test('session and car calendar requests share one canonical source cache key',()=>{
  assert.equal(normalizeDataPath('/api/events?year=2026&status=result-v3'),normalizeDataPath('/api/events?year=2026'));
  assert.equal(normalizeDataPath('/api/session?year=2026&gp=Bahrain&session=R&data_schema=old'),normalizeDataPath('/api/session?year=2026&gp=Bahrain&session=R'));
  assert.notEqual(normalizeDataPath('/api/session?year=2026&gp=Bahrain&session=R'),normalizeDataPath('/api/session?year=2026&gp=Bahrain&session=Q'));
});
test('preference storage is optional and cannot break page startup',()=>{
  const context={localStorage:{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}}};
  vm.createContext(context);vm.runInContext(coreSource,context);
  assert.equal(context.ApexAnalysis.preference('descriptions',false),false);
  assert.doesNotThrow(()=>context.ApexAnalysis.savePreference('descriptions',true));
});
test('observed brake and DRS channels preserve missing observations',()=>{
  const c=core();for(const value of [null,undefined,'']){assert.equal(c.observedBrake(value),null);assert.equal(c.observedDRS(value),null);}
  assert.equal(c.observedBrake(false),0);assert.equal(c.observedBrake(true),100);
  assert.equal(c.observedDRS(12),1);assert.equal(c.observedDRS(8),0);
});
test('sorting keeps nulls last in both directions and preserves ties and source order',()=>{
  const rows=[{id:'a',v:2},{id:'missing',v:null},{id:'b',v:1},{id:'c',v:2}],c=core();
  assert.equal(c.sortRows(rows,{v:r=>r.v},'v',1).map(r=>r.id).join(','),'b,a,c,missing');
  assert.equal(c.sortRows(rows,{v:r=>r.v},'v',-1).map(r=>r.id).join(','),'a,c,b,missing');
  assert.equal(rows.map(r=>r.id).join(','),'a,missing,b,c');
});
function discreteHarness(){
  const context={clampTelemetry:n=>Math.max(0,Math.min(1,n)),hasTelemetryNumber:n=>n!==null&&n!==undefined&&Number.isFinite(+n),rawFractionAt:(_,p)=>p.AlignedFraction,
    traceSampleFraction:(_,p)=>p.AlignedFraction};vm.createContext(context);
  vm.runInContext(alignment.slice(alignment.indexOf('function alignedValue('),alignment.indexOf('\nfunction interpolate(',alignment.indexOf('function alignedValue('))),context);
  vm.runInContext(app.slice(app.indexOf('function discreteTraceState('),app.indexOf('\nfunction sampledEnhancedTrace(')),context);
  vm.runInContext(app.slice(app.indexOf('function renderedTraceValue('),app.indexOf('\nconst TRACE_PLOT_LEFT')),context);
  return context;
}
test('visible discrete traces and hover agree at actual source transitions, not midpoints',()=>{
  const h=discreteHarness(),values=[0,100,null,0,100,100];
  const rows=values.map((Brake,i)=>({Brake,AlignedFraction:i/5,ElapsedSeconds:i*.2}));
  const path=h.measuredDiscreteTrace(rows,'Brake',0,1);
  for(const fraction of [0,.1,.2,.3,.5,.6,.7,.8,1])assert.equal(h.renderedTraceValue(path,fraction,true),h.alignedValue(rows,fraction,'Brake'));
  assert.equal(h.renderedTraceValue(path,.1,true),0);assert.equal(h.renderedTraceValue(path,.3,true),null);
});
test('a long discrete-channel source gap is not bridged by the chart',()=>{
  const h=discreteHarness(),rows=[{Brake:0,AlignedFraction:0,ElapsedSeconds:0},{Brake:100,AlignedFraction:.5,ElapsedSeconds:3},{Brake:0,AlignedFraction:1,ElapsedSeconds:3.2}];
  const path=h.measuredDiscreteTrace(rows,'Brake',0,1);
  assert.equal(h.renderedTraceValue(path,.25,true),null);assert.equal(h.renderedTraceValue(path,.5,true),100);
  assert.equal(h.discreteTraceState('Brake',null),null);
});
test('missing fastest-lap entrants stay visible without inheriting a measured score',()=>{
  const context={telemetryEvent:e=>e};vm.createContext(context);
  vm.runInContext(car.slice(car.indexOf('function retainQualifyingEntrants('),car.indexOf('\nfunction seasonTelemetry(')),context);
  const event={Q:{teams:[{team:'A'},{team:'B'}]},traceExcluded:{B:'GPS unavailable'}};
  const rows=context.retainQualifyingEntrants([{team:'A',categories:{},trace:{corners:[]}}],[event]);
  assert.equal(rows.length,2);assert.equal(rows[1].missingReason,'GPS unavailable');assert.equal(rows[1].brakingScore,null);
  assert.deepEqual(Object.keys(rows[1].categories),[]);
});
test('selected measurements are not silently replaced when coverage is unavailable',()=>{
  assert.doesNotMatch(car,/selectedBrakeView=brakingView==='approach'&&hasApproach/);
  assert.doesNotMatch(car,/if\s*\(noStationary\)\s*pitMeasure\s*=/);
  assert.match(car,/tableSortGroups\.get\(sort\.dataset\.performanceSort\)\|\|sort\.dataset\.sortTable/);
  assert.match(car,/Race points scored · sprints excluded/);
});

test('failed and cancelled session loads retain the previous workspace and restore controls',async()=>{
  const classes=new Set(),button={disabled:false,classList:{contains:c=>classes.has(c),add:c=>classes.add(c),remove:c=>classes.delete(c)},setAttribute(){},removeAttribute(){}};
  const main={classList:{contains:()=>false}},analysis={setAttribute(){}},sidebar={};let clears=0;
  const box={AbortController,sessionRequest:null,currentQuery:()=>new URLSearchParams('year=2026&gp=Bahrain&session=R'),apiUrl:p=>p,
    $:s=>s==='#loadSession'?button:s==='main'?main:s==='.analysis-column'?analysis:sidebar,
    clearBeforeSessionLoad:()=>{clears++;},renderCharts(){},notify(){},loadApiData:async()=>{throw Error('offline');}};
  vm.createContext(box);vm.runInContext(app.slice(app.indexOf('async function loadRealSession()'),app.indexOf('// UI Rendering Functions')),box);
  await box.loadRealSession();assert.equal(clears,0);assert.equal(analysis.inert,false);assert.equal(button.disabled,false);
  box.loadApiData=(_,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>{const error=Error('stopped');error.name='AbortError';reject(error);}));
  const pending=box.loadRealSession();assert.equal(button.textContent,'Stop loading');assert.equal(analysis.inert,true);
  await box.loadRealSession();await pending;
  assert.equal(clears,0);assert.equal(button.textContent,'Load session');assert.equal(analysis.inert,false);assert.equal(button.disabled,false);
});
