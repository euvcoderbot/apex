// Recompute qualifying corner comparisons from existing native lap packs.
// No new lap data is fabricated and missing packs remain unranked.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {qualifyingRepresentatives,sessionWithCircuitCorners} from '../corner-geometry.js';
import {measureQualifyingCornerGroup} from '../race-cornering.js';
import {mergeLocalCaptures} from '../lib/local-captures.mjs';
import {SOURCE_REVISION,BACKEND_REVISION,RACE_REVISION} from '../lib/cache-revision.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const year=Number(process.argv[2]||2026),origin=`http://127.0.0.1:${Number(process.env.APEX_LOCAL_PORT||54123)}`;
const revisions={sourceRevision:SOURCE_REVISION,backendRevision:BACKEND_REVISION,measurementRevision:RACE_REVISION};
const status=await fetch(origin+'/api/local-status').then(r=>r.json());
if(status.mode!=='local'||Object.entries(revisions).some(([k,v])=>status[k]!==v))throw Error('Start the matching local server before preparing historical corners.');
const readJson=async f=>JSON.parse(await readFile(f,'utf8'));
const unpack=async f=>JSON.parse(gunzipSync(await readFile(f)));
const base=path.join(root,'assets/data/prerendered'),manifest=await readJson(path.join(base,'index.json'));
const packDir=path.join(root,'assets/data/telemetry'),packs=await readJson(path.join(packDir,'index.json'));
if(!(manifest.sourceRevision==='debb63ddadd0fabe2d70'&&packs.sourceRevision===manifest.sourceRevision&&SOURCE_REVISION==='5b02cc1bb2a6daf808ad'&&manifest.revision==='8168b392ef2edc130d33'&&BACKEND_REVISION==='1af2a5e364d242f1b28d'))
  throw Error('Historical inputs do not match the explicitly audited storage-only revision pair.');
const events=await readJson(path.join(root,`assets/data/events/${year}.json`));
const records=Object.entries(manifest.entries).map(([key,file])=>({url:new URL(key,'http://local'),file}));
const report=[];
for(const event of events){
  const find=(endpoint,session)=>records.find(r=>r.url.pathname===endpoint&&r.url.searchParams.get('gp')===event.name&&Number(r.url.searchParams.get('year'))===year&&session.includes(r.url.searchParams.get('session')));
  const s=find('/api/session',['Q','Qualifying']),p=find('/api/performance',['Q']);
  if(!s||!p)continue;
  let session={...await unpack(path.join(base,s.file)),year,event:event.name};
  const performance=await unpack(path.join(base,p.file));
  session=await sessionWithCircuitCorners(session,async(key,y)=>{
    const r=await fetch(origin+'/api/circuit-guide?'+new URLSearchParams({key,year:y}));if(!r.ok)throw Error('Circuit guide unavailable');return r.json();
  });
  for(const subject of ['team','driver']){
    const rows=qualifyingRepresentatives(session,subject,performance.teams),entries=[],requestErrors=[];
    for(const row of rows){
      const file=packs.entries[`${year}:${event.name}:Qualifying:${row.driver.code}`];
      if(!file){requestErrors.push({driver:row.driver.code,reason:'No retained native pack'});continue;}
      const pack=await unpack(path.join(packDir,file)),payload=pack.laps?.[String(row.lap)];
      const end=payload?.samples?.at(-1)?.ElapsedSeconds;
      if(!payload||String(pack.sessionKey)!==String(session.openf1_session_key)||payload.driver!==row.driver.code||payload.samples?.length<30||!Number.isFinite(end)||Math.abs(end-row.time)>.005){
        requestErrors.push({driver:row.driver.code,reason:'Lap identity or recorded duration is unsupported'});continue;
      }
      entries.push({row,payload});
    }
    const cornerClassificationDrivers=qualifyingRepresentatives(session,'team',performance.teams).map(r=>r.driver.code);
    const measured=measureQualifyingCornerGroup(entries,{...session,cornerClassificationDrivers});
    const legacy=measureQualifyingCornerGroup(entries,{...session,cornerClassificationDrivers,cornerWindowMode:'legacy'});
    const entrants=subject==='team'?(performance.teams||[]).map(t=>({team:t.team,driver:t.lap?.driver,displayName:t.team,logoTeam:t.team,color:t.color,lap:t.lap})):
      rows.map(r=>({team:r.driver.code,driver:r.driver.code,displayName:r.driver.name,logoTeam:r.driver.team,color:r.driver.team_color,lap:{driver:r.driver.code,number:r.driver.number,lap:r.lap,time:r.time,phase:r.phase,compound:r.compound}}));
    const complete=requestErrors.length===0&&rows.every(r=>measured.traces[r.driver.code]&&!measured.traces[r.driver.code].corner_missing?.length);
    const data={...measured,legacyTraces:legacy.traces,entrants,requested:rows.length,received:entries.length,requestErrors,date:session.date,complete,
      source_input:{kind:'retained-native-packs',source_revision:packs.sourceRevision,manifest_generated:manifest.generated}};
    if(Object.keys(data.traces||{}).length){
      const route='/api/qualifying-corners?'+new URLSearchParams({year,gp:event.name,round:event.round,subject});
      await mergeLocalCaptures(root,revisions,[{route,data}]);
    }
    const line={gp:event.name,subject,requested:rows.length,received:entries.length,markers:measured.markers?.length||0,complete,error:measured.error||null};
    report.push(line);console.log(JSON.stringify(line));
  }
}
console.log(JSON.stringify({events:report.length/2,complete:report.filter(x=>x.complete).length,partial:report.filter(x=>!x.complete&&x.received).length}));
