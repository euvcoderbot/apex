import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {ageAdjustedRaceCornerScores,raceCornerGroups} from '../race-cornering.js';
const source=fs.readFileSync('car-performance.js','utf8');
const avg=a=>a.reduce((s,v)=>s+v,0)/a.length,median=a=>{a=[...a].sort((a,b)=>a-b);return (a[(a.length-1)>>1]+a[a.length>>1])/2;};
function context(){const box={finite:Number.isFinite,avg,median};vm.createContext(box);vm.runInContext(source.slice(source.indexOf('function eventAdjustedScores('),source.indexOf('const STRAIGHT_PILLS=')),box);return box;}
test('mean and median solve the exact long-chain comparison, not a stopped iteration',()=>{
  const box=context(),reports=Array.from({length:20},(_,j)=>({event:{name:'GP'+j},summary:{rows:new Map(Array.from({length:3},(_,k)=>{const i=j+k;return ['D'+i,{team:'D'+i,value:j*.1+i*.01}];}))}}));
  for(const mode of ['mean','median']){const result=box.eventAdjustedScores(reports,r=>r.value,mode,'inferred');
    for(const [d,v]of result)assert.ok(Math.abs(v-Number(d.slice(1))*.01)<1e-8);
    assert.equal(result.diagnostics.converged,true);assert.ok(result.diagnostics.leaveGPOut.D21.fits>=3);
  }
});
test('estimated median resists skew while a disconnected component never shares a zero',()=>{
  const box=context(),rows=[1,1,1,1,20].map((value,i)=>({event:{name:'GP'+i},summary:{rows:new Map([['A',{team:'A',v:0}],['B',{team:'B',v:value}],['C',{team:'C',v:value+1}]])}}));
  const mean=box.eventAdjustedScores(rows,r=>r.v,'mean','inferred'),robust=box.eventAdjustedScores(rows,r=>r.v,'median','inferred');
  assert.ok(mean.get('B')>4);assert.ok(Math.abs(robust.get('B')-1)<.01);
  rows.push({event:{name:'disconnected'},summary:{rows:new Map(['XYZ'].flatMap(x=>[...x].map((t,i)=>[t,{team:t,v:i}])) )}});
  const result=box.eventAdjustedScores(rows,r=>r.v,'mean','inferred');assert.equal(result.has('X'),false);assert.equal(result.diagnostics.components.length,2);
});
test('raw DRS codes preserve documented on/off/unknown semantics',()=>{
  const box={};vm.createContext(box);vm.runInContext(fs.readFileSync('analysis-core.js','utf8'),box);
  for(const code of [0,1,8])assert.equal(box.ApexAnalysis.observedDRS(code),0);
  for(const code of [10,12,14])assert.equal(box.ApexAnalysis.observedDRS(code),1);
  for(const code of [2,3,9,11,15])assert.equal(box.ApexAnalysis.observedDRS(code),null);
});
test('age-adjusted race corners recover a known contrast only when age is identifiable',()=>{
  const rows=[];
  for(let lap=5;lap<=18;lap++)for(let d=0;d<4;d++){
    const age=lap%((d+1)*3)+d+2,value=3+d*.05+age*.01;
    rows.push({team:'D'+d,driver:'D'+d,lap,compound:'MEDIUM',tyreAge:age,snapshot:lap+':M',cornerIds:['1'],cornerBands:[{corner:'1',band:'low'}],times:[value],values:{all:value,low:value}});
  }
  const fit=ageAdjustedRaceCornerScores(rows);assert.equal(fit.status,'estimated');
  for(let d=0;d<4;d++)assert.ok(Math.abs(fit.scores.get('D'+d)-d*.05)<1e-8);
  assert.ok(Math.abs(fit.ageEffects.MEDIUM-.01)<1e-8);
  const confounded=rows.map(r=>({...r,tyreAge:Number(r.team.slice(1))+r.lap}));
  assert.equal(ageAdjustedRaceCornerScores(confounded).scores.size,0);
});
test('full-race plan includes every eligible cohort without a coverage-target stop',()=>{
  const drivers=Array.from({length:15},(_,d)=>({code:'D'+d,team:'D'+d,laps:Array.from({length:60},(_,i)=>({lap:i+2,time:90+d/10,compound:'MEDIUM',track_status:'1',stint:1,tyre_life:i+2+Math.floor(d/3)*10+d%3,
    lap_start_seconds:(i+2)*100+d*6,lap_end_seconds:(i+2)*100+d*6+90+d/10}))}));
  const result=raceCornerGroups({drivers});assert.ok(result.length>96);assert.equal(result.length,result.plan.availableGroups);assert.equal(result.plan.allGroupsSelected,true);
  const capped=raceCornerGroups({drivers},{},12);assert.equal(capped.length,12);assert.equal(capped.plan.budgetReached,true);
  assert.ok(result.every(g=>Math.max(...g.rows.map(r=>r.tyre_life))-Math.min(...g.rows.map(r=>r.tyre_life))<=4));
});
