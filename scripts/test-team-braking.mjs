import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {fastestTeamTelemetrySelections} from '../qualifying-telemetry.js';
import {createDataCache,SOURCE_VERSION,DATA_VERSION,RACE_VERSION} from '../lib/data-cache.mjs';
import seed from '../lib/verified-cache-seed.json' with {type:'json'};
const source=readFileSync('car-performance.js','utf8');
const [performanceKey,summary]=Object.entries(seed.entries).find(([k])=>k.startsWith('data:')&&k.includes('session=Q'));
const [batchKey,batchEntry]=Object.entries(seed.entries).find(([k])=>k.includes('trace-batch?'));
test('braking requests exactly the fastest lap for eleven teams and reuses captured calculations',async()=>{
  const windows=fastestTeamTelemetrySelections(summary.data.teams);
  assert.equal(windows.length,11);assert.ok(windows.every(s=>s.time===s.qualifying_best_time&&s.lap===s.qualifying_best_lap));
  const path='/api/performance/trace-batch?'+new URLSearchParams({year:2026,gp:'Bahrain Grand Prix',windows:JSON.stringify(windows)});
  // Pin this captured fixture to the revisions under test; production seed validation remains strict.
  const bootstrap={...seed,sourceRevision:SOURCE_VERSION.slice(7),backendRevision:DATA_VERSION.slice(5),raceRevision:RACE_VERSION.slice(5)};
  const cache=createDataCache({seeded:true,bootstrap,read:async()=>null,write:async()=>{},now:()=>batchEntry.expires-1000,fetcher:async()=>{throw new Error('Must not request upstream');}});
  const result=await cache.get(path);assert.equal(result.cache,'HIT');assert.equal(Object.keys(result.data.teams).length,11);
  assert.equal(Object.values(result.data.teams).reduce((n,t)=>n+t.braking.length,0),42);
});
test('independent braking loading is not blocked by a straight-line batch and does not replace its traces',async()=>{
  const event={name:'Bahrain Grand Prix',Q:summary.data,traces:{original:{marker:'preserve'}}},calls=[];
  const box={teamBrakingRunning:false,running:false,context:{year:2026},generation:1,events:[event],AbortController,URLSearchParams,
    traceRunning:true,fastestTeamTelemetrySelections,render:()=>{},updateStatus:()=>{},get:async path=>{calls.push(path);return structuredClone(batchEntry.data);}};
  vm.createContext(box);vm.runInContext(source.slice(source.indexOf('async function loadTeamBraking('),source.indexOf('async function loadTeamTelemetry(')),box);
  await box.loadTeamBraking();assert.equal(calls.length,1);assert.equal(event.teamBrakingReady,true);assert.equal(Object.keys(event.brakingTraces).length,11);
  assert.equal(event.traces.original.marker,'preserve');await box.loadTeamBraking();assert.equal(calls.length,1);
  event.teamBrakingReady=false;box.get=async()=>{throw new Error('temporary failure');};await box.loadTeamBraking();assert.match(event.brakingError,/temporary/);
  assert.equal(Object.keys(event.brakingTraces).length,11,'supported observations survive a failed retry');
});
test('ranking eligibility never hides other measured braking evidence',()=>{
  const box={finite:Number.isFinite,avg:a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null,
    median:a=>a.length?[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)]:null,brakingQualityMode:'supported',brakingComparisonMode:'paired',telemetryCoverageMode:'common'};
  vm.createContext(box);vm.runInContext(source.slice(source.indexOf('function eventTelemetry(event)'),source.indexOf('function seasonTelemetry(')),box);
  const result=box.eventTelemetry({Q:summary.data,traces:batchEntry.data.teams});
  assert.equal(result.rows.size,11);assert.equal(result.brakingCoverage.teams.length,5);
  assert.equal(result.rows.get('Red Bull Racing').brakeEvidence.length,4);assert.equal(result.rows.get('Red Bull Racing').brakingSlowingS,null);
  assert.match(source,/Unranked does not mean unloaded/);assert.match(source,/Every observed braking interval/);
});
