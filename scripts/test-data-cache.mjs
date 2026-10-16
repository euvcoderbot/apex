import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import vm from 'node:vm';
import {createDataCache,normalizeDataPath,dataTTL,usableData,RACE_VERSION,SOURCE_VERSION,DATA_VERSION} from '../lib/data-cache.mjs';
import {loadRaceSnapshot,loadCachedRaceSnapshots,loadRaceCornerPlan} from '../lib/race-corner-loader.mjs';
import {connectedRaceCornerScores} from '../race-cornering.js';
import verifiedSeed from '../lib/verified-cache-seed.json' with {type:'json'};

test('native race batches run one at a time and a rate limit starts a shared cooldown',async()=>{
  let active=0,maxActive=0,calls=0;
  const cache=createDataCache({read:async()=>null,write:async()=>{},fetcher:async()=>{
    calls++;active++;maxActive=Math.max(active,maxActive);await new Promise(resolve=>setTimeout(resolve,5));active--;
    return {ok:true,json:async()=>({method:'native-race-streams-v1',laps:[{lap:2}]})};
  }});
  const path=n=>'/api/performance/race-laps?year=2026&gp=Test&driver_number='+n+'&session_key=99';
  await Promise.all([1,2,3].map(n=>cache.get(path(n))));assert.equal(calls,3);assert.equal(maxActive,1);
  let limitedCalls=0,clock=1000;
  const limited=createDataCache({read:async()=>null,write:async()=>{},now:()=>clock,fetcher:async()=>{
    limitedCalls++;return {ok:false,status:429,json:async()=>({detail:'Native source rate limited'})};
  }});
  await assert.rejects(limited.get(path(1)),/rate limited/);
  await assert.rejects(limited.get(path(2)),/cooldown/);assert.equal(limitedCalls,1);
  clock+=60001;await assert.rejects(limited.get(path(2)),/rate limited/);assert.equal(limitedCalls,2);
});

test('retained timing inventory does not censor independently available live race laps',async()=>{
  const drivers=['A','B','C'].map((code,i)=>({code,number:String(i+1),team:code,laps:Array.from({length:10},(_,n)=>({lap:n+2,time:90,s1:30,s2:30,s3:30,stint:1,
    track_status:'1',compound:'MEDIUM',tyre_life:n+2,lap_start_seconds:(n+2)*100+i*5,lap_end_seconds:(n+2)*100+i*5+90}))}));
  const session={drivers,source_cache:{kind:'verified-recording'},available_telemetry:drivers.map(d=>({driver:d.code,lap:2}))};
  const payload={source:'OpenF1',samples:Array.from({length:101},(_,i)=>({Distance:i*50,ElapsedSeconds:i*.9,Speed:200}))};
  let probes=0;
  const cache={result:async(k,compute)=>({data:await compute()}),get:async path=>{
    if(path.startsWith('/api/session?'))return {data:session};
    if(path.startsWith('/api/performance?'))return {data:{teams:[]}};
    probes++;return {data:payload};
  }};
  const result=await loadRaceCornerPlan(cache,{year:2026,gp:'Test Grand Prix',round:1});
  assert.equal(result.data.groups.length,10);assert.equal(probes,1);
  assert.equal(result.data.plan.sourceLimited,false);
  assert.equal(result.data.source_coverage.kind,'live-native-with-retained-fallback');
});

test('unavailable live race telemetry falls back to retained cohorts with a disclosed reason',async()=>{
  const drivers=['A','B','C'].map((code,i)=>({code,number:String(i+1),team:code,laps:[2,3].map(lap=>({lap,time:90,s1:30,s2:30,s3:30,stint:1,
    track_status:'1',compound:'MEDIUM',tyre_life:lap,lap_start_seconds:lap*100+i*5,lap_end_seconds:lap*100+i*5+90}))}));
  const session={drivers,source_cache:{kind:'verified-recording'},available_telemetry:drivers.map(d=>({driver:d.code,lap:2}))};
  const cache={result:async(k,compute)=>({data:await compute()}),get:async path=>{
    if(path.startsWith('/api/session?'))return {data:session};
    if(path.startsWith('/api/performance?'))return {data:{teams:[]}};
    throw new Error('Native provider unavailable');
  }};
  const result=await loadRaceCornerPlan(cache,{year:2026,gp:'Test Grand Prix',round:1});
  assert.equal(result.data.groups.length,1);assert.equal(result.data.plan.sourceLimited,true);
  assert.match(result.data.source_coverage.probeError,/Native provider unavailable/);
});

test('source-only compatible migration keeps expiry and never reuses old model scores',async()=>{
  const path='/api/telemetry?year=2026&gp=Test&session=Q&driver=A&lap=2';
  const store=new Map(),identity=normalizeDataPath(path);
  const old={data:{samples:Array(40).fill({Speed:200})},expires:2000};
  store.set('source:cd189bb22d7369619f33:'+identity,old);
  store.set('data:cd189bb22d7369619f33:'+normalizeDataPath('/api/performance?year=2026&gp=Test&session=Q'),{data:{teams:[{pace:99}]},expires:2000});
  let requests=0;
  const cache=createDataCache({read:async k=>store.get(k),write:async(k,v)=>store.set(k,v),now:()=>1000,
    fetcher:async()=>{requests++;return {ok:true,json:async()=>({teams:[{pace:1}]})};}});
  assert.equal((await cache.get(path)).cache,'HIT');
  assert.equal(store.get(SOURCE_VERSION+':'+identity).expires,2000);
  assert.equal((await cache.get('/api/performance?year=2026&gp=Test&session=Q')).data.teams[0].pace,1);
  assert.equal(requests,1);
});

test('session inventory refreshes while identical v12 results retain their original expiry',async()=>{
  const store=new Map(),session=normalizeDataPath('/api/session?year=2026&gp=Test&session=R'),perf=normalizeDataPath('/api/performance?year=2026&gp=Test&session=R');
  store.set('source:29f8563d4b78ab40fa9f:'+session,{data:{drivers:[{code:'OLD'}]},expires:2000});
  store.set('data:41044143c0b685844c70:'+perf,{data:{teams:[{team:'A'}],method:'car-performance-v12-supported-nonlinear'},expires:2000});
  let calls=0;const cache=createDataCache({read:async k=>store.get(k),write:async(k,v)=>store.set(k,v),now:()=>1000,
    fetcher:async()=>{calls++;return {ok:true,json:async()=>({drivers:[{code:'NEW'}],available_telemetry:[]})};}});
  assert.equal((await cache.get(session)).data.drivers[0].code,'NEW');
  assert.equal((await cache.get(perf)).cache,'HIT');
  assert.equal(store.get(DATA_VERSION+':'+perf).expires,2000);assert.equal(calls,1);
});

test('recorded-source caching cannot renew its original freshness',()=>{
  const now=Date.parse('2026-10-15T00:00:00Z'),data={date:'2026-10-01',source_cache:{expires_at:'2026-10-16T00:00:00Z'}};
  const path='/api/session?year=2026&gp=Test&session=R';
  assert.equal(dataTTL(path,data,[],now),86400);
  assert.equal(dataTTL(path,{...data,source_cache:{expires_at:'2026-10-14T00:00:00Z'}},[],now),0);
  assert.equal(dataTTL(path,{...data,source_cache:{...data.source_cache,stale:true}},[],now),120);
});

test('delivered approach revision never migrates strict-only v12 batch scores',async()=>{
  const path='/api/performance/trace-batch?year=2026&gp=Test',identity=normalizeDataPath(path),store=new Map();
  store.set('data:41044143c0b685844c70:'+identity,{data:{teams:{A:{braking:[]}},methodology_version:'car-measurements-v12-local-evidence'},expires:2000});
  let calls=0;const cache=createDataCache({read:async k=>store.get(k),write:async(k,v)=>store.set(k,v),now:()=>1000,
    fetcher:async()=>{calls++;return {ok:true,json:async()=>({teams:{A:{braking:[{approach_timing_supported:true}]}},methodology_version:'car-measurements-v13-delivered-approach'})};}});
  const result=await cache.get(path);assert.equal(calls,1);assert.equal(result.data.teams.A.braking[0].approach_timing_supported,true);
});

test('partial stationary timing revalidates quickly even for an old completed race',()=>{
  const path='/api/performance/pits?year=2026&gp=Singapore Grand Prix';
  const now=Date.parse('2026-10-14T00:00:00Z');
  const complete={date:'2026-10-11T12:00:00Z',stationary_status:'complete',visits:[{stop_duration:2.2}]};
  assert.equal(dataTTL(path,complete,[],now),30*86400);
  assert.equal(dataTTL(path,{...complete,stationary_status:'partial'},[],now),300);
  assert.equal(dataTTL(path,{...complete,stationary_status:'unavailable'},[],now),300);
  assert.equal(usableData(path,{visits:[]}),false);
  assert.equal(usableData(path,{visits:[{stop_duration:2.2}]}),true);
});

test('durable reads coalesce, expired memory rechecks shared storage, and validation runs once',async()=>{
  let reads=0,writes=0,validations=0,clock=1000;
  const store=new Map([['key',{data:{value:1},expires:2000}]]);
  const cache=createDataCache({read:async key=>{reads++;await new Promise(resolve=>setImmediate(resolve));return store.get(key);},
    write:async(key,entry)=>{writes++;store.set(key,entry);},now:()=>clock});
  const results=await Promise.all(Array.from({length:20},()=>cache.result('key',async()=>{throw new Error('Unexpected calculation');})));
  assert.equal(reads,1);assert.ok(results.every(r=>r.cache==='HIT'&&r.data.value===1));
  clock=2500;store.set('key',{data:{value:2},expires:4000});
  assert.equal((await cache.peek('key')).data.value,2);assert.equal(reads,2);
  await cache.result('other',async()=>({value:3}),{valid:()=>{validations++;return true;}});
  assert.equal(validations,1);assert.equal(writes,1);
});

test('durable-hit memory stays bounded and recently accessed entries remain cached',async()=>{
  let reads=0;
  const cache=createDataCache({read:async key=>{reads++;return {data:key,expires:1000000};},write:async()=>{},now:()=>0});
  for(let i=0;i<128;i++)await cache.peek(String(i));
  await cache.peek('0');await cache.peek('128');
  assert.equal(reads,129);
  await cache.peek('0');assert.equal(reads,129,'recently accessed hit is retained');
  await cache.peek('1');assert.equal(reads,130,'oldest hit was evicted');
});

test('trusted bootstrap serves eleven measured teams without upstream requests and persists original expiry',async()=>{
  const store=new Map(),clock=Math.min(...Object.values(verifiedSeed.entries).map(e=>e.expires))-1000;
  // A matching-version fixture tests the bootstrap contract independently of
  // whether this checkout has intentionally invalidated its production seed.
  const bootstrap={...verifiedSeed,sourceRevision:SOURCE_VERSION.slice(7),backendRevision:DATA_VERSION.slice(5),raceRevision:RACE_VERSION.slice(5)};
  let calls=0;const options={seeded:true,bootstrap,read:async k=>store.get(k),write:async(k,v)=>store.set(k,v),now:()=>clock,
    fetcher:async()=>{calls++;throw new Error('Upstream unavailable');}};
  const cache=createDataCache(options);
  const query={year:2026,gp:'Singapore Grand Prix',round:17};
  const session='/api/session?'+new URLSearchParams({...query,session:'R'}),performance='/api/performance?'+new URLSearchParams({year:2026,gp:query.gp,session:'R'});
  assert.equal((await cache.get(session)).cache,'HIT');
  assert.equal((await cache.get(performance)).data.teams.length,11);
  const observations=[];
  const snapshots=Object.entries(verifiedSeed.entries).filter(([k])=>k.startsWith('race:')&&k.includes('lap=')&&k.endsWith('subject=team'));
  for(const [key,entry] of snapshots){
    const q=Object.fromEntries(new URLSearchParams(key.slice(5)));q.year=+q.year;q.round=+q.round;q.lap=+q.lap;
    const result=await loadRaceSnapshot(cache,q);assert.equal(result.cache,'HIT');observations.push(...result.data.observations);
    assert.equal(store.get(RACE_VERSION+':'+key.slice(5)).expires,entry.expires);
  }
  const fit=connectedRaceCornerScores(observations);
  assert.equal(fit.scores.size,11);assert.equal(calls,0);
  const batch=await loadCachedRaceSnapshots(cache,query);
  assert.equal(batch.data.snapshots.length,snapshots.length);
  assert.equal(connectedRaceCornerScores(batch.data.snapshots.flatMap(h=>h.snapshot.observations)).scores.size,11);assert.equal(calls,0);
  assert.equal((await createDataCache(options).get(performance)).cache,'HIT');
  await assert.rejects(cache.get(performance,{fresh:true}),/Upstream unavailable/);
});

test('bootstrap is opt-in, revision-specific and cannot outlive captured data',async()=>{
  const options={read:async()=>null,write:async()=>{},now:()=>Math.max(...Object.values(verifiedSeed.entries).map(e=>e.expires))+1};
  for(const seeded of [false,true]){
    const cache=createDataCache({...options,seeded});let calculations=0;
    const result=await cache.result(RACE_VERSION+':'+Object.keys(verifiedSeed.entries).find(k=>k.startsWith('race:')).slice(5),async()=>{calculations++;return {expired:true};});
    assert.equal(result.cache,'MISS');assert.equal(calculations,1);
  }
  const cache=createDataCache({...options,seeded:true,now:()=>0});
  const result=await cache.result('race:wrong:'+Object.keys(verifiedSeed.entries).find(k=>k.startsWith('race:')).slice(5),async()=>({recomputed:true}));
  assert.equal(result.cache,'MISS');assert.ok(result.data.recomputed);
});

test('shared data cache survives new instances, coalesces cold work and isolates refresh/version keys',async()=>{
  const store=new Map();let calls=0,clock=Date.parse('2026-10-07');
  const options={read:async k=>store.get(k),write:async(k,v)=>store.set(k,v),now:()=>clock,
    fetcher:async()=>{calls++;return {ok:true,json:async()=>({teams:[{team:'A',pace:calls}]})};}};
  const cache=createDataCache(options),path='/api/performance?session=Q&gp=Test&year=2025';
  const results=await Promise.all([cache.get(path),cache.get(path)]);
  assert.equal(calls,1);assert.equal(results[0].data.teams[0].pace,1);
  assert.equal((await createDataCache(options).get(path)).cache,'HIT');assert.equal(calls,1);
  assert.equal((await cache.get(path,{fresh:true})).data.teams[0].pace,2);
  clock+=366*86400000;await createDataCache(options).get(path);assert.equal(calls,3);
  assert.equal(normalizeDataPath('/api/session?year=2025&gp=Test&fresh=true&session=Q'),'/api/session?gp=Test&session=Q&year=2025');
  assert.throws(()=>normalizeDataPath('//evil.example/api/session?year=2025&gp=Test'));
  assert.throws(()=>normalizeDataPath('/api/admin?year=2025'));
});

test('late corrections expire quickly, old completed events cache longer and partial failures never become durable',async()=>{
  const now=Date.parse('2026-10-07T12:00:00Z');
  assert.equal(dataTTL('/api/events?year=2026',[],null,now),300);
  assert.equal(dataTTL('/api/session?year=2026&gp=Test&session=R',{date:'2026-10-07T10:00:00Z'},null,now),120);
  assert.equal(dataTTL('/api/performance?year=2026&gp=Test&session=R',{},[{name:'Test',session_dates:{Race:'2026-09-27T10:00:00Z'}}],now),30*86400);
  assert.equal(usableData('/api/session?year=2026',{drivers:[{}],lap_data_complete:false}),false);
  assert.equal(usableData('/api/telemetry?year=2026',{samples:Array(40).fill({}),position_complete:false}),false);
  const store=new Map();let attempts=0;
  const cache=createDataCache({read:async k=>store.get(k),write:async(k,v)=>store.set(k,v),fetcher:async()=>({ok:true,json:async()=>{attempts++;return {error:'incomplete',teams:{}};}})});
  await cache.get('/api/performance/trace-batch?year=2026&gp=Test');await cache.get('/api/performance/trace-batch?year=2026&gp=Test');
  assert.equal(attempts,2);assert.equal(store.size,0);
});

test('Sepang race snapshots compute once from validated source laps and persist across instances',async()=>{
  const fixture=JSON.parse(gunzipSync(readFileSync(new URL('./race-cornering-sepang-2026.json.gz',import.meta.url))));
  const entries=fixture.entries.map((entry,i)=>({...entry,row:{...entry.row,stint:1,track_status:'1',tyre_life:17,lap_start_seconds:1000+i*12,lap_end_seconds:1000+i*12+entry.row.time},
    payload:{...entry.payload,corners:fixture.markers.map((m,i)=>({...m,number:String(i+1)}))}}));
  const session={date:'2026-09-27',circuit_key:12,corners:fixture.markers,drivers:entries.map(e=>({...e.row.driver,laps:[e.row]}))};
  let requests=0;const store=new Map();
  const options={read:async k=>store.get(k),write:async(k,v)=>store.set(k,v),fetcher:async url=>{
    requests++;const u=new URL(url),data=u.pathname==='/api/session'?session:u.pathname==='/api/performance'?{teams:entries.map(e=>({team:e.row.driver.team,fastest_race_driver:e.row.driver.code}))}:entries.find(e=>e.row.driver.code===u.searchParams.get('driver')).payload;
    return {ok:true,json:async()=>data};
  }};
  const query={year:2026,gp:'Bahrain Grand Prix',round:16,lap:17,compound:'MEDIUM'};
  const first=await loadRaceSnapshot(createDataCache(options),query);
  assert.ok(first.data.complete,first.data.reason);assert.equal(first.data.observations.length,4);
  assert.equal(first.data.observations[0].corners,15);
  const count=requests,again=await loadRaceSnapshot(createDataCache(options),query);
  assert.equal(again.cache,'HIT');assert.equal(requests,count);assert.deepEqual(again.data.observations,first.data.observations);
});

test('race selection starts its loader and pace does not eagerly fetch qualifying telemetry',()=>{
  const source=readFileSync('car-performance.js','utf8'),calls=[];
  const box={running:false,context:{},activeMetric:'corners',cornerSession:'race',telemetrySubject:'team',straightLineSource:'qualy',
    loadRaceCorners:()=>calls.push('race'),loadQualifyingMetrics:()=>calls.push('qualy'),loadTeamTelemetry:()=>calls.push('team')};
  vm.createContext(box);vm.runInContext(source.slice(source.indexOf('function loadActiveTelemetry()'),source.indexOf('async function loadTeamBraking(')),box);
  box.loadActiveTelemetry();assert.deepEqual(calls,['race']);
  box.activeMetric='pace';box.loadActiveTelemetry();assert.equal(calls.length,1);
  box.activeMetric='straight';box.loadActiveTelemetry();assert.deepEqual(calls,['race','team']);
  box.straightLineSource='race';box.loadActiveTelemetry();assert.deepEqual(calls,['race','team'],'race speed traps need no qualifying trace load');
  assert.match(source,/cornerSession=cornerSessionButton.dataset.cornerSession;render\(\);loadActiveTelemetry\(\)/);
  const loader=source.slice(source.indexOf('async function loadRaceCorners('),source.indexOf('function renderRaceCorners()'));
  assert.doesNotMatch(loader,/fresh:'true'/);assert.match(loader,/snapshot \$\{index\+1\}/);
});

test('a displaced selected archive is recovered without relative timing boundaries and its corrected snapshot persists',async()=>{
  const fixture=JSON.parse(gunzipSync(readFileSync(new URL('./race-cornering-bahrain-2026-live.json.gz',import.meta.url))));
  const entries=fixture.entries.map((e,i)=>({...e,row:{...e.row,stint:1,track_status:'1',tyre_life:8,lap_start_seconds:1000+i*12,lap_end_seconds:1000+i*12+e.row.time}}));
  const session={...fixture.session,drivers:entries.map(e=>({...e.row.driver,laps:[e.row]}))};
  const fixed=structuredClone(entries.find(e=>e.row.driver.code==='BEA').payload),per=entries.find(e=>e.row.driver.code==='PER');
  const ratio=per.row.time/fixed.samples.at(-1).ElapsedSeconds;
  fixed.samples.forEach(point=>point.ElapsedSeconds*=ratio);fixed.source='OpenF1';
  let recovery=0;const store=new Map();
  const options={read:async k=>store.get(k),write:async(k,v)=>store.set(k,v),fetcher:async url=>{
    const q=new URL(url),code=q.searchParams.get('driver')||entries.find(e=>String(e.row.driver.number)===q.searchParams.get('driver_number'))?.row.driver.code;let data;
    if(q.pathname==='/api/session')data=session;
    else if(q.pathname==='/api/performance')data={teams:entries.map(e=>({team:e.row.driver.team,fastest_race_driver:e.row.driver.code}))};
    else if(q.pathname==='/api/performance/race-laps'){
      const e=entries.find(e=>e.row.driver.code===code),columns=['Distance','ElapsedSeconds','Speed','X','Y','SourceIntervalSeconds','PositionIntervalSeconds'];
      data={method:'native-race-streams-v1',source:e.payload.source,columns,laps:[{lap:e.row.lap,time:e.row.time,points:e.payload.samples.map(p=>columns.map(c=>p[c]))}]};
    }
    else if(code==='PER'&&!q.searchParams.has('lap_start_seconds')){recovery++;data=fixed;}
    else data=entries.find(e=>e.row.driver.code===code).payload;
    return {ok:true,json:async()=>data};
  }};
  const query={year:2026,gp:'Bahrain Grand Prix',round:16,lap:17,compound:'MEDIUM'};
  const result=await loadRaceSnapshot(createDataCache(options),query);
  assert.ok(result.data.complete,result.data.reason);assert.equal(result.data.observations.length,4);assert.equal(recovery,1);
  assert.equal((await loadRaceSnapshot(createDataCache(options),query)).cache,'HIT');assert.equal(recovery,1);
});
