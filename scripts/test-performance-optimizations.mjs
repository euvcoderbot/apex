import {appSource} from './app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import vm from 'node:vm';
import {createDataCache} from '../lib/data-cache.mjs';
import {loadQualifyingCorners} from '../lib/qualifying-corner-loader.mjs';
import {loadRaceCornerPlan} from '../lib/race-corner-loader.mjs';
import {measureRaceCornerGroup,connectedRaceCornerScores} from '../race-cornering.js';

test('partial qualifying batch persists briefly across isolates without turning exclusions into zeros',async()=>{
  const store=new Map();let requests=0,clock=1000;
  const options={read:async k=>store.get(k),write:async(k,v)=>store.set(k,v),now:()=>clock,
    fetcher:async()=>({ok:true,json:async()=>{requests++;return {teams:{A:{top_speed:320}},excluded:{B:'Missing GPS'}};}})};
  const path='/api/performance/trace-batch?year=2026&gp=Test';
  const one=await createDataCache(options).get(path);assert.equal(one.ttl,120);
  assert.equal((await createDataCache(options).get(path)).cache,'HIT');assert.equal(requests,1);
  assert.equal(one.data.teams.B,undefined);clock+=121000;
  await createDataCache(options).get(path);assert.equal(requests,2);
});

function qualifyingFixture(){
  const f=JSON.parse(gunzipSync(readFileSync(new URL('./race-cornering-sepang-2026.json.gz',import.meta.url))));
  const entries=f.entries.map((e,i)=>({...e,row:{...e.row,phase:'Q3',compound:'SOFT',lap_start_seconds:100,lap_end_seconds:100+e.row.time},
    payload:{...e.payload,samples:e.payload.samples.map(p=>({...p,X:1000*Math.cos(p.Distance/e.payload.samples.at(-1).Distance*Math.PI*2),Y:1000*Math.sin(p.Distance/e.payload.samples.at(-1).Distance*Math.PI*2)})),corners:f.markers.map((m,i)=>({...m,number:String(i+1)}))}}));
  const session={date:'2026-09-27',circuit_key:12,drivers:entries.map(e=>({...e.row.driver,laps:[e.row]}))};
  const performance={teams:entries.map(e=>({team:e.row.driver.team,lap:{driver:e.row.driver.code,lap:e.row.lap,time:e.row.time}}))};
  return {entries,session,performance};
}

test('server qualifying calculations coalesce, persist, and retry only the incomplete native lap',async()=>{
  const {entries,session,performance}=qualifyingFixture(),store=new Map();let requests=0,refreshes=[];
  const bad=entries[0],lo=bad.payload.samples.at(-1).Distance*.32,hi=lo+180;
  const options={read:async k=>store.get(k),write:async(k,v)=>store.set(k,v),fetcher:async url=>{
    requests++;const u=new URL(url),entry=entries.find(e=>e.row.driver.code===u.searchParams.get('driver'));
    let data=u.pathname==='/api/session'?session:u.pathname==='/api/performance'?performance:entry.payload;
    if(u.pathname==='/api/telemetry'&&entry===bad&&!u.searchParams.has('fresh'))data={...entry.payload,samples:entry.payload.samples.filter(p=>p.Distance<lo||p.Distance>hi)};
    if(u.pathname==='/api/telemetry'&&u.searchParams.has('fresh'))refreshes.push(entry.row.driver.code);
    return {ok:true,json:async()=>data};}};
  const query={year:2026,gp:'Bahrain Grand Prix',round:'16',subject:'team'},cache=createDataCache(options);
  const [a,b]=await Promise.all([loadQualifyingCorners(cache,query),loadQualifyingCorners(cache,query)]);
  assert.equal(a,b);assert.equal(a.data.received,4);assert.equal(a.data.entrants.length,4);
  assert.ok(a.data.traces[bad.row.driver.code].corners.length>0);
  assert.equal(a.data.complete,false);assert.ok(a.data.traces[bad.row.driver.code].corner_missing.length>0);
  assert.ok(!JSON.stringify(a.data).includes('"samples"'),'native sample arrays are not sent to the chart client');
  const count=requests;
  assert.equal((await loadQualifyingCorners(createDataCache(options),query)).cache,'HIT');assert.equal(requests,count);
  const recovered=await loadQualifyingCorners(createDataCache(options),{...query,fresh:true});
  assert.equal(recovered.data.complete,true);assert.deepEqual(refreshes,[bad.row.driver.code]);
  assert.equal(recovered.data.traces[bad.row.driver.code].selection.lap,bad.row.lap);
});

test('race selection plans are computed once and never serialize every drivers lap list inside each selected row',async()=>{
  const {entries,session,performance}=qualifyingFixture();
  for(const [i,e] of entries.entries())session.drivers[i].laps=[{...e.row,track_status:'1',tyre_life:17,stint:1,compound:'MEDIUM',lap_start_seconds:1000+i*12,lap_end_seconds:1000+i*12+e.row.time}];
  const store=new Map();let requests=0;
  const options={read:async k=>store.get(k),write:async(k,v)=>store.set(k,v),fetcher:async url=>{requests++;return {ok:true,json:async()=>new URL(url).pathname==='/api/session'?session:performance};}};
  const q={year:2026,gp:'Bahrain Grand Prix',round:'16',subject:'team'};
  const a=await loadRaceCornerPlan(createDataCache(options),q),count=requests;
  assert.ok(a.data.groups.length);assert.ok(a.data.groups.every(g=>g.rows.every(r=>r.driver.laps===undefined)));
  assert.equal((await loadRaceCornerPlan(createDataCache(options),q)).cache,'HIT');assert.equal(requests,count);
});

test('one long local telemetry gap retains unaffected race corners and all connected measured entrants',()=>{
  const f=JSON.parse(gunzipSync(readFileSync(new URL('./race-cornering-sepang-2026.json.gz',import.meta.url))));
  const entry=f.entries[0],lo=entry.payload.samples.at(-1).Distance*.32,hi=lo+180;
  entry.payload.samples=entry.payload.samples.filter(p=>p.Distance<lo||p.Distance>hi);
  const measured=measureRaceCornerGroup(f.entries,f.markers);
  assert.equal(new Set(measured.map(o=>o.driver)).size,4);
  assert.ok(measured.some(o=>o.corners<15));
  assert.ok(measured.every(o=>o.times.every(Number.isFinite)));
  const result=connectedRaceCornerScores(measured.map(o=>({...o,snapshot:o.lap+':'+o.compound+':'+o.cornerIds.join(',')})));
  assert.equal(result.scores.size,4);
});

test('overlapping partial corner blocks cannot multiply the same physical lap-pair evidence',()=>{
  const block=(team,ids,times,snapshot)=>({team,driver:team,lap:10,compound:'MEDIUM',cornerIds:ids,times,
    cornerBands:ids.map(corner=>({corner,band:'high'})),corners:ids.length,snapshot,values:{all:0,high:0}});
  const data=['A','B','C'].map((name,i)=>block(name,['1','2'],[2+i*.1,3+i*.2],'full'));
  const duplicate=['A','B','C'].map((name,i)=>block(name,['1'],[2+i*.1],'partial'));
  const base=connectedRaceCornerScores(data),expanded=connectedRaceCornerScores([...data,...duplicate]);
  assert.deepEqual(expanded.scores,base.scores);
  assert.deepEqual(connectedRaceCornerScores([...data,...duplicate].reverse()).scores,expanded.scores);
});


test('source cache versions do not change on presentation edits and loader categories do not cancel session retrieval',()=>{
  const app=appSource(),ui=readFileSync('car-performance.js','utf8');
  assert.match(app,/window.APEX_SOURCE_VERSION/);assert.match(app,/response.headers.get\('x-data-ttl'\)/);
  assert.match(ui,/done\+\+; (?:scheduleRender|render)\(\);loadActiveTelemetry\(\)/);
});

test('cold distinct requests obey the shared upstream concurrency budget while cache hits bypass the queue',async()=>{
  let active=0,peak=0,requests=0;
  const cache=createDataCache({read:async()=>null,write:async()=>{},fetcher:async()=>{
    requests++;active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;
    return {ok:true,json:async()=>({teams:[{team:'A'}],date:'2025-01-01'})};}});
  await Promise.all(Array.from({length:18},(_,i)=>cache.get('/api/performance?'+new URLSearchParams({year:2025,gp:'Test '+i,session:'Q'}))));
  assert.equal(peak,6);assert.equal(requests,18);
  await cache.get('/api/performance?'+new URLSearchParams({year:2025,gp:'Test 0',session:'Q'}));assert.equal(requests,18);
});


test('background native telemetry leaves foreground source slots available',async()=>{
  const releases=[],started=[];
  const cache=createDataCache({read:async()=>null,write:async()=>{},fetcher:async url=>{
    started.push(new URL(url).pathname);await new Promise(resolve=>releases.push(resolve));
    return {ok:true,json:async()=>new URL(url).pathname==='/api/telemetry'?{samples:Array(40).fill({})}:{teams:[{team:'A'}]}};}});
  const low=Array.from({length:6},(_,i)=>cache.get('/api/telemetry?'+new URLSearchParams({year:2025,gp:'Test '+i})));
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(started.length,4);
  const high=cache.get('/api/performance?year=2025&gp=Foreground&session=Q');
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(started.at(-1),'/api/performance');
  while(releases.length)releases.splice(0).forEach(resolve=>resolve());
  await new Promise(resolve=>setTimeout(resolve,0));releases.splice(0).forEach(resolve=>resolve());
  await Promise.all([...low,high]);
});

test('an empty automatic race queue never changes loading state or recursively restarts the loader',async()=>{
  const source=readFileSync('car-performance.js','utf8');let renders=0,restarts=0;
  const box={raceCornerRunning:false,context:{year:2026},generation:2,telemetrySubject:'team',events:[],raceCornerCache:new Map(),raceCornerAttempts:new Map(),
    render(){renders++;},loadActiveTelemetry(){restarts++;},AbortController};
  vm.createContext(box);vm.runInContext(source.slice(source.indexOf('async function loadRaceCorners('),source.indexOf('function renderRaceCorners()')),box);
  await box.loadRaceCorners(true);assert.equal(renders,0);assert.equal(restarts,0);assert.equal(box.raceCornerRunning,false);
  box.events=[{name:'Test',R:{}}];box.raceCornerAttempts.set('2026:Test:team',2);
  await box.loadRaceCorners(true);assert.equal(renders,0);assert.equal(restarts,0);
});
