// Requires the loopback runner. No hosted API fallback is permitted.
import {fastestTeamTelemetrySelections} from '../qualifying-telemetry.js';
import {qualifyingRepresentatives} from '../corner-geometry.js';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SOURCE_REVISION,BACKEND_REVISION,RACE_REVISION} from '../lib/cache-revision.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),arg=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const year=Number(arg('--year','2026')),gp=arg('--gp','Singapore Grand Prix');
const origin=`http://127.0.0.1:${Number(process.env.APEX_LOCAL_PORT||54123)}`;
async function request(route,body){const r=await fetch(origin+route,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(180000)});const data=await r.json();if(!r.ok)throw new Error(data.detail||'Local calculation failed');return {data,cache:r.headers.get('X-Data-Cache')};}
try{const status=(await request('/api/local-status')).data;if(status.mode!=='local')throw new Error('Not a local compute server');}
catch{throw new Error('Start start-local.cmd (or npm run local) before precomputing. No Vercel fallback was used.');}
const start=Date.now();
const calendar=(await request('/api/data',{path:'/api/events?'+new URLSearchParams({year})})).data;
const allEvents=Array.isArray(calendar)?calendar:calendar.events||[];
// --season warms every event whose race has run; otherwise just --gp.
const targets=args.includes('--season')
  ?allEvents.filter(e=>e.date&&new Date(e.date+'T23:59:59Z').getTime()<Date.now())
  :allEvents.filter(e=>e.name===gp);
if(!targets.length)throw new Error('Grand Prix not found in this season');
let batch={};
for(const event of targets){
const gp=event.name;
try{
const round=event.round||'';
const get=async route=>{const result=await request('/api/data',{path:route});console.log(JSON.stringify({route:route.split('?')[0],cache:result.cache}));return result.data;};
const q=await get('/api/performance?'+new URLSearchParams({year,gp,session:'Q'}));
await get('/api/performance?'+new URLSearchParams({year,gp,session:'R'}));
const session=await get('/api/session?'+new URLSearchParams({year,gp,round,session:'Q'}));
// Use the browser's exact representative-selection function and property order.
const windows=fastestTeamTelemetrySelections(q.teams);
batch=await get('/api/performance/trace-batch?'+new URLSearchParams({year,gp,windows:JSON.stringify(windows),measures:'speed'}));
// Same driver windows, field order included, as the page (car-performance.js
// driverSelectionsFromQualifying), so the cached batch is the one it requests.
const fromPhases=(()=>{const best=new Map();for(const team of q.teams||[])for(const p of team.phase_details||[]){
  if(![p.time,p.start,p.end].every(Number.isFinite)||p.lap==null||p.number==null||!p.driver)return null;
  if(!best.has(p.driver)||p.time<best.get(p.driver).time)best.set(p.driver,p);}
  return best.size>=3?[...best.values()].map(p=>({driver:p.driver,number:p.number,lap:p.lap,time:p.time,start:p.start,end:p.end,sectors:p.sectors,phase:p.phase,
    compound:p.compound,team:p.driver,team_name:p.driver,driver_number:p.number,qualifying_best_time:p.time,qualifying_best_driver:p.driver,qualifying_best_lap:p.lap})):null;})();
const driverWindows=fromPhases||qualifyingRepresentatives({...session,year,event:gp},'driver',q.teams).map(row=>({driver:row.driver.code,number:row.driver.number,lap:row.lap,time:row.time,start:row.lap_start_seconds,end:row.lap_end_seconds,
  sectors:[row.s1,row.s2,row.s3],phase:row.phase,compound:row.compound,team:row.driver.code,team_name:row.driver.code,driver_number:row.driver.number,
  qualifying_best_time:row.time,qualifying_best_driver:row.driver.code,qualifying_best_lap:row.lap}));
await get('/api/performance/trace-batch?'+new URLSearchParams({year,gp,windows:JSON.stringify(driverWindows),measures:'speed'}));
for(const subject of ['team','driver']){
  const query=new URLSearchParams({year,gp,round,subject});
  console.log(JSON.stringify({subject,corners:(await request('/api/qualifying-corners?'+query)).cache}));
  if(args.includes('--race')){
    const plan=(await request('/api/race-corners?'+new URLSearchParams({...Object.fromEntries(query),cached:'1'}))).data;
    const cached=new Set((plan.snapshots||[]).filter(s=>s.snapshot.complete).map(s=>s.lap+':'+s.compound+':'+s.cohort));
    let completed=cached.size,hits=cached.size;
    for(const group of (plan.groups||[]).filter(g=>!cached.has(g.lap+':'+g.compound+':'+g.cohort))){const r=await request('/api/race-corners?'+new URLSearchParams({...Object.fromEntries(query),lap:group.lap,compound:group.compound,cohort:group.cohort}));if(r.cache==='HIT')hits++;if(r.data.complete)completed++;if(r.data.sourcePaused)throw new Error('Source rate limited. Completed work remains cached; retry later.');}
    if(completed!==(plan.groups||[]).length)throw new Error(`Only ${completed}/${plan.groups?.length||0} race groups completed. Supported work remains cached.`);
    console.log(JSON.stringify({subject,raceGroups:plan.groups?.length||0,completed,cacheHits:hits}));
  }
}
try{await get('/api/performance/pits?'+new URLSearchParams({year,gp}));}catch(e){console.warn('Pit data: '+e.message);}
// Session analysis summaries, with the page's own session names (session-state.js
// currentQuery; the cache key ignores its data_schema field).
for(const name of ['Qualifying','Sprint Qualifying','Sprint','Race']){
  const date=event.session_dates?.[name];
  if(!date||Date.parse(date)+4*3600000>Date.now())continue;
  try{await get('/api/session?'+new URLSearchParams({year,gp,round,session:name}));}catch(e){console.warn(`Session ${name}: `+e.message);}
}
if(event.session_dates?.Sprint)try{await get('/api/performance/sprint?'+new URLSearchParams({year,gp,round}));}catch(e){console.warn('Sprint classification: '+e.message);}
}catch(error){console.warn(JSON.stringify({gp,skipped:error.message}));if(targets.length===1)throw error;}
}
if(args.includes('--export-seed')){
  const filename=path.join(root,'lib/verified-cache-seed.json'),old=JSON.parse(await readFile(filename,'utf8'));
  const entries={};
  for(const [key,value] of Object.entries(old.entries||{}))if(value.expires>Date.now()&&((key.startsWith('source:')&&old.sourceRevision===SOURCE_REVISION)||(key.startsWith('race:')&&old.raceRevision===RACE_REVISION)))entries[key]=value;
  const prefixes={source:SOURCE_REVISION,data:BACKEND_REVISION,race:RACE_REVISION};
  const directory=path.join(root,'.apex-cache/dashboard');
  for(const file of await readdir(directory)){
    if(!file.endsWith('.json'))continue;
    const v=JSON.parse(await readFile(path.join(directory,file),'utf8')),m=/^(source|data|race):([^:]+):(.*)$/.exec(v.key||'');
    if(!m||m[2]!==prefixes[m[1]]||v.expires<=Date.now())continue;
    // Ship compact results only. Raw full race streams and native lap arrays stay local.
    if(m[1]==='source'&&!m[3].startsWith('/api/session?')&&!m[3].startsWith('/api/events?'))continue;
    if(m[1]==='data'&&m[3].startsWith('/api/performance/race-laps?'))continue;
    entries[m[1]+':'+m[3]]={data:v.data,expires:v.expires};
  }
  await writeFile(filename,JSON.stringify({sourceRevision:SOURCE_REVISION,backendRevision:BACKEND_REVISION,raceRevision:RACE_REVISION,entries}));
  console.log(JSON.stringify({exportedEntries:Object.keys(entries).length,note:'Publish a normal Site release to share these compact cached results.'}));
}
console.log(JSON.stringify({done:true,events:targets.length,year,seconds:Math.round((Date.now()-start)/1000),method:batch.methodology_version,cars:Object.keys(batch.speed_domain?.cars||{}).length}));
