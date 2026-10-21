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
  for(const key of ['straight','straight_top','energy'])assert.match(source,new RegExp(`key:'${key}'`));
  // Braking loader stores the block without disturbing its own traces.
  const event={name:'GP',Q:{teams:[]}};
  const result={teams:{A:{braking:[],selection:{}}},excluded:{},speed_domain:{cars:{A:{}}}};
  const box={teamBrakingRunning:false,context:{year:2026},generation:1,events:[event],AbortController,URLSearchParams,
    firstTelemetryAttempt:()=>true,loadActiveTelemetry:()=>{},fastestTeamTelemetrySelections:()=>[{team:'A'},{team:'B'},{team:'C'}],
    render:()=>{},updateStatus:()=>{},get:async()=>structuredClone(result)};
  vm.createContext(box);
  vm.runInContext(source.slice(source.indexOf('async function loadTeamBraking('),source.indexOf('async function loadTeamTelemetry(')),box);
  await box.loadTeamBraking();
  assert.deepEqual(Object.keys(event.speedDomain.team.cars),['A']);
  assert.ok(event.brakingTraces.A);
});
