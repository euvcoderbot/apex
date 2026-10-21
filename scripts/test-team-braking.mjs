import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {fastestTeamTelemetrySelections} from '../qualifying-telemetry.js';
import {createDataCache,SOURCE_VERSION,DATA_VERSION,RACE_VERSION} from '../lib/data-cache.mjs';
import seed from './fixtures/v120/lib/verified-cache-seed.json' with {type:'json'};
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
