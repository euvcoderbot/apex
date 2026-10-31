import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {speedDomainValue,speedDomainEventValues,speedDomainSeason,speedDomainPhases} from '../speed-domain.js';

const car=(grip,straight,braking)=>({cornering:{low:{index:1,time_vs_median_s:grip}},straight:{index:1,gap_to_median_s:straight},braking:{index:1,gap_pct:braking}});

test('values are deficits: corner seconds, straight seconds, braking %',()=>{
  const c=car(1.5,.02,4);
  assert.equal(speedDomainValue(c,'corner_low'),1.5);
  assert.equal(speedDomainValue(c,'straight'),.02);
  assert.equal(speedDomainValue(c,'braking'),4);
  assert.equal(speedDomainValue({straight:{index:null,gap_to_median_s:.1}},'straight'),null,'unsupported index is not a value');
  assert.equal(speedDomainValue(c,'corner_high'),null);
});

test('several GPs compare % of corner time, not seconds that differ by circuit',()=>{
  const band=(s,pct)=>({cornering:{low:{index:1,time_vs_median_s:s,pct_vs_median:pct,phases_s:{braking:s/2,mid:0,exit:s/2}}}});
  assert.equal(speedDomainValue(band(.4,1.2),'corner_low'),.4);
  assert.equal(speedDomainValue(band(.4,1.2),'corner_low_pct'),1.2);
  assert.equal(speedDomainValue({cornering:{low:{index:null,pct_vs_median:1}}},'corner_low_pct'),null);
  const events=[{name:'GP1',speedDomain:{team:{cars:{A:band(0,0),B:band(.2,.5),C:band(.4,1)}}}},
                {name:'GP2',speedDomain:{team:{cars:{A:band(0,0),B:band(.6,1.5),C:band(1.2,3)}}}}];
  const phases=Object.fromEntries(speedDomainPhases(events,'team','low').map(r=>[r.name,r]));
  // Centred on each GP's median, equal weight per GP, phases add to the total.
  assert.ok(Math.abs(phases.A.braking-(-.1-.3)/2)<1e-12);
  assert.equal(phases.B.braking+phases.B.mid+phases.B.exit,0);
  assert.equal(phases.C.gps,2);
});

test('each GP is centred on its median entrant; fewer than three entrants is no comparison',()=>{
  const values=speedDomainEventValues({cars:{A:car(0,0,0),B:car(2,0,0),C:car(4,0,0)}},'corner_low');
  assert.deepEqual(values,{A:-2,B:0,C:2});
  assert.deepEqual(speedDomainEventValues({cars:{A:car(0,0,0),B:car(1,0,0)}},'corner_low'),{});
});

test('season weights GPs equally and leaves sparsely measured entrants unranked, not zero',()=>{
  const events=[
    {name:'GP1',speedDomain:{team:{cars:{A:car(0,0,0),B:car(1,0,0),C:car(2,0,0),D:car(3,0,0)}}}},
    {name:'GP2',speedDomain:{team:{cars:{A:car(0,0,0),B:car(3,0,0),C:car(6,0,0)}}}},
    {name:'GP3',speedDomain:{team:{cars:{A:car(0,0,0),B:car(1,0,0),C:car(2,0,0)}}}}
  ];
  const season=speedDomainSeason(events,'team','corner_low');
  assert.equal(season.gps,3);
  const row=name=>season.rows.find(r=>r.name===name);
  assert.ok(row('A').value<row('B').value&&row('B').value<row('C').value);
  assert.equal(row('D').value,null);
  assert.match(row('D').missingReason,/1 of 3/);
});

test('one GP with fast corners remains visible when the other selected circuits have none',()=>{
  const cars=Object.fromEntries(['A','B','C'].map((name,i)=>[name,{cornering:{high:{index:1,time_vs_median_s:i*.02}}}]));
  const events=[{name:'Baku',Q:{},speedDomain:{team:{cars:{A:{},B:{},C:{}}}}},
    {name:'Sepang',Q:{},speedDomain:{team:{cars}}},
    {name:'Singapore',Q:{},speedDomain:{team:{cars:{A:{},B:{},C:{}}}}}];
  const result=speedDomainSeason(events,'team','corner_high');
  assert.equal(result.gps,1);
  assert.deepEqual(result.events,['Sepang']);
  assert.equal(result.rows.filter(row=>Number.isFinite(row.value)).length,3);
});

test('sparse speed packets propagate provisional status to the chart, not other metrics',()=>{
  const cars=Object.fromEntries(['A','B','C'].map((name,i)=>[name,{...car(i,.01*i,0),cornering:{low:{index:1,time_vs_median_s:i,provisional:name==='B'}}}]));
  const events=[{name:'GP',speedDomain:{driver:{cars}}}];
  const rows=speedDomainSeason(events,'driver','corner_low').rows;
  assert.equal(rows.find(r=>r.name==='A').provisional,false);
  assert.equal(rows.find(r=>r.name==='B').provisional,true);
  assert.equal(speedDomainSeason(events,'driver','straight').rows.find(r=>r.name==='B').provisional,false);
});

test('the page defaults to speed-domain and keeps every trace-batch speed-domain block',async()=>{
  const source=readFileSync('car-performance.js','utf8');
  assert.match(source,/let speedDomainMethod='speed'/);
  // One method on the page; straight line is three pills, one chart at a time.
  assert.doesNotMatch(source,/data-speed-method/);
  // The pills are drawn by src/views/SpeedView.tsx from STRAIGHT_PILLS.
  assert.match(readFileSync('src/views/SpeedView.tsx','utf8'),/data-straight-pill=\{x\.key\}/);
  assert.match(source,/pills:STRAIGHT_PILLS\.map/);
  for(const key of ['track_straights','straight_top','energy'])assert.match(source,new RegExp(`key:'${key}'`));
  // Straight line is measured on each track's own straights, not a simulated one.
  assert.match(source,/let straightPill='track_straights'/);
  assert.doesNotMatch(source,/key:'straight',label/);
});

function loader(result) {
  const source=readFileSync('car-performance.js','utf8'),event={name:'Test GP',Q:{teams:[]}};
  const box={context:{year:2026},events:[event],telemetrySubject:'team',generation:1,
    speedDomainRunning:{team:false},speedDomainController:{},AbortController,URLSearchParams,
    firstTelemetryAttempt:()=>true,fastestTeamTelemetrySelections:()=>[1,2,3],
    render(){},scheduleRender(){},updateStatus(){},loadActiveTelemetry(){},get:async()=>result};
  vm.createContext(box);
  vm.runInContext(source.slice(source.indexOf('async function loadSpeedDomain('),source.indexOf('function loadActiveTelemetry()')),box);
  return {box,event};
}

for(const result of [{},{speed_domain:{cars:{}}},{error:'Upstream unavailable',speed_domain:{cars:{}}}]) {
  test(`empty qualifying telemetry is retryable, not a completed blank (${JSON.stringify(result)})`,async()=>{
    const {box,event}=loader(result);
    await box.loadSpeedDomain();
    assert.equal(box.speedDomainRunning.team,false);
    assert.equal(event.speedDomain?.team,undefined);
    assert.match(event.speedDomainError,/no measured entrants|Upstream unavailable/);
  });
}

test('loading remains pending until telemetry arrives, then retains supported entrants',async()=>{
  const result={speed_domain:{cars:{A:car(0,0,0),B:car(1,0,0),C:car(2,0,0)}}};
  const {box,event}=loader(result);let finish;
  box.get=()=>new Promise(resolve=>{finish=resolve;});
  const pending=box.loadSpeedDomain();
  assert.equal(box.speedDomainRunning.team,true);
  finish(result);await pending;
  assert.equal(box.speedDomainRunning.team,false);
  assert.equal(event.speedDomain.team,result.speed_domain);
  assert.equal(event.speedDomainError,undefined);
});

test('telemetry loading status remains visible with explanations disabled',()=>{
  const css=readFileSync('macos-window.css','utf8'),view=readFileSync('src/views/SpeedView.tsx','utf8');
  assert.match(css,/p\.performance-quality-status:not\(\.is-loading\):not\(:has\(button\)\)/);
  assert.match(view,/p\.status\.running \? ' is-loading'/);
  assert.match(view,/Lap times are loaded; fetching and processing the fastest laps/);
});

test('real straights and lap shares put corners and straights on the qualifying-gap scale',()=>{
  const c={field_lap_time_s:90,
    cornering:{low:{index:1,time_vs_median_s:.9,pct_vs_median:5,provisional:false}},
    track_straights:{index:1,time_vs_median_s:.45,pct_vs_median:1.2,provisional:true}};
  // 5% slower through slow corners that take 18 s of a 90 s lap is 1% of the lap.
  assert.equal(speedDomainValue(c,'corner_low_pct'),5);
  assert.equal(speedDomainValue(c,'corner_low_lap'),1);
  assert.equal(speedDomainValue(c,'track_straights'),.45);
  assert.equal(speedDomainValue(c,'track_straights_pct'),1.2);
  assert.equal(speedDomainValue(c,'track_straights_lap'),.5);
  assert.equal(speedDomainValue({track_straights:{index:null}},'track_straights'),null,'unmeasured is not zero');
  assert.equal(speedDomainValue({cornering:{low:{index:1,time_vs_median_s:1}}},'corner_low_lap'),null,'no lap time, no share');
  const event=cars=>({name:'GP',speedDomain:{team:{cars}}});
  const season=speedDomainSeason([event({A:c,B:{...c,track_straights:{...c.track_straights,time_vs_median_s:0}},C:{...c,track_straights:{...c.track_straights,time_vs_median_s:-.45}}})],'team','track_straights_lap');
  assert.ok(season.rows.find(r=>r.name==='A').provisional,'a provisional straight marks the row');
});

test('a car with a missing braking, mid-corner or exit phase is left out of the breakdown, not counted as zero seconds',()=>{
  const phased=(braking,mid,exit)=>({cornering:{low:{index:1,phases_s:{braking,mid,exit}}}});
  const events=[{name:'A',speedDomain:{team:{cars:{X:phased(.10,.20,.30),Y:phased(0,.10,.20),Z:phased(-.10,0,.10),W:phased(null,.15,.25),V:phased(undefined,.15,.25),U:phased(Number.NaN,.15,.25)}}}}];
  const rows=speedDomainPhases(events,'team','low');
  assert.deepEqual(rows.map(r=>r.name).sort(),['X','Y','Z']);
  for(const row of rows)for(const k of ['braking','mid','exit'])assert.ok(Number.isFinite(row[k]),`${row.name} ${k}`);
});

test('braking is low confidence in 2026 (weak teammate agreement) and keeps its backend label elsewhere', async () => {
  const {speedDomainIsLowConfidence} = await import('../speed-domain.js');
  assert.equal(speedDomainIsLowConfidence(2026, 'braking', ['moderate']), true);
  assert.equal(speedDomainIsLowConfidence(2025, 'braking', ['moderate']), false);
  assert.equal(speedDomainIsLowConfidence(2025, 'traction', ['low']), true, 'a low backend label always wins');
  assert.equal(speedDomainIsLowConfidence(2026, 'straight', ['established']), false);
});
