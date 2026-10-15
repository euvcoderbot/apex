import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync('car-performance.js','utf8');
const median=a=>{const s=a.filter(Number.isFinite).sort((x,y)=>x-y),i=s.length>>1;return s.length?s.length%2?s[i]:(s[i-1]+s[i])/2:null;};
function runtime(){const box={finite:Number.isFinite,avg:a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null,median,
  brakingComparisonMode:'connected',brakingQualityMode:'supported',brakingApproachBasis:'delivered',STRAIGHT_BANDS:[],events:[]};
  vm.createContext(box);vm.runInContext(source.slice(source.indexOf('function eventTelemetry(event)'),source.indexOf('function seasonTelemetry(')),box);return box;}
function fixture(data){const traces=structuredClone(data.result.teams);
  for(const t of Object.values(traces)){t.braking_selection_policy='fastest-qualifying-lap-only';t.braking_selection=t.selection;}
  return {name:data.gp,Q:{teams:data.selections.map(s=>({team:s.team,lap:{...s}}))},traces};
}

test('delivered and strict paired modes retain identical source laps but different documented boundary support',()=>{
  const box=runtime(),lap=driver=>({driver,lap:10,time:90});
  const event={Q:{teams:['A','B','C','D'].map(team=>({team,lap:lap(team)}))},traces:Object.fromEntries(['A','B','C','D'].map((team,i)=>[team,
    {selection:lap(team),braking_selection:lap(team),braking_selection_policy:'fastest-qualifying-lap-only',braking:[{corner:'Z',method:'matched-speed-v1',mode:'straight',quality:'supported',
      source_laps:1,source_selection:lap(team),approach_source_lap:10,entry_speed:280,exit_speed:180,duration:1+i*.1,
      approach_time:2+i*.1,approach_timing_supported:true,approach_comparable:team!=='D'}]}]))};
  const delivered=box.eventTelemetry(event);assert.equal(delivered.brakingCoverage.teams.length,4);
  assert.ok(Number.isFinite(delivered.rows.get('D').brakingApproachMs));
  box.brakingApproachBasis='matched';const strict=box.eventTelemetry(event);
  assert.equal(strict.brakingCoverage.teams.length,3);assert.equal(strict.rows.get('D').brakingApproachMs,null);
  assert.equal(strict.rows.get('D').brakingSlowingS,null,'paired slowing must use the same strict cohort');
  assert.equal(delivered.rows.get('D').lap.lap,10);
  assert.match(source,/const brakingComparisonMode='connected'/);
  assert.doesNotMatch(source,/data-braking-view="approach"[^>]*disabled/);
});

test('braking exposes just two metrics with a fixed supported paired methodology',()=>{
  const controls=source.slice(source.indexOf('function brakingViewControls('),source.indexOf('\n}',source.indexOf('function brakingViewControls('))+2);
  const box={brakingView:'deceleration'};vm.createContext(box);vm.runInContext(controls,box);
  const slowing=box.brakingViewControls();assert.equal((slowing.match(/<button/g)||[]).length,2);
  assert.match(slowing,/Same-speed slowing/);assert.match(slowing,/Time through braking zone/);
  assert.match(slowing,/Time to shed the same speed/);
  box.brakingView='approach';assert.match(box.brakingViewControls(),/includes arrival and exit speed/);
  assert.doesNotMatch(source,/data-braking-(?:comparison|quality|basis)/);
  assert.match(source,/const brakingQualityMode='supported'/);assert.match(source,/const brakingApproachBasis='delivered'/);
  assert.match(source,/const summaryStat=activeMetric==='braking'\?'mean':telemetrySeasonStat/);
  assert.doesNotMatch(source,/return statisticControls\+card\(brakingTitle/);
});

// Optional audit runner: generated real-native results are local test inputs,
// not committed telemetry or a substitute for the synthetic contract above.
if(process.env.APEX_BRAKING_REPLAY)for(const label of ['Singapore-team','Singapore-driver','Sepang-team']){
  const file=`../outputs/${process.env.APEX_BRAKING_REPLAY}-${label}.json`;
  if(!existsSync(file))throw Error('Missing native replay '+file);
  const data=JSON.parse(readFileSync(file)),event=fixture(data),box=runtime();
  for(const basis of ['delivered','matched'])for(const comparison of ['connected','paired','independent'])for(const quality of ['supported','all']){
    box.brakingApproachBasis=basis;box.brakingComparisonMode=comparison;box.brakingQualityMode=quality;
    const result=box.eventTelemetry(event),rows=[...result.rows.values()],slowing=rows.filter(r=>Number.isFinite(r.brakingSlowingS)),approach=rows.filter(r=>Number.isFinite(r.brakingApproachMs));
    if(comparison!=='independent')assert.deepEqual(approach.map(r=>r.team),slowing.map(r=>r.team));
    if(basis==='delivered'&&comparison==='connected'&&quality==='supported')assert.equal(approach.length,data.subject==='driver'?21:11);
    console.log(JSON.stringify({gp:data.gp,subject:data.subject,basis,comparison,quality,measured:rows.length,slowing:slowing.length,approach:approach.length,zones:result.brakingCoverage.events.length,unranked:rows.filter(r=>!Number.isFinite(r.brakingSlowingS)).map(r=>r.team)}));
  }
}
