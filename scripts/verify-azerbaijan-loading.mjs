// Replay the actual session, corner and native-batch paths, not only pace.
import {writeFile} from 'node:fs/promises';
import {fastestTeamTelemetrySelections} from '../qualifying-telemetry.js';
const origin=process.env.APEX_VERIFY_ORIGIN||'http://127.0.0.1:54123';
const results=[];
async function get(path,{facade=false}={}){
  const url=origin+(facade?'/api/data?'+new URLSearchParams({path}):path);
  const start=Date.now(),r=await fetch(url,{signal:AbortSignal.timeout(180000)}),d=await r.json();
  if(!r.ok||d.detail||d.error)throw Error(JSON.stringify({path,status:r.status,error:d.detail||d.error}));
  results.push({path:path.split('?')[0],status:r.status,seconds:(Date.now()-start)/1000});return d;
}
const base={year:2026,gp:'Azerbaijan Grand Prix',round:15,session:'Q'};
const facade=origin.includes('chatgpt.site');
const session=await get('/api/session?'+new URLSearchParams(base),{facade});
if(session.drivers?.length!==22||!session.lap_data_complete||session.corners?.length!==20)throw Error('Incomplete session source');
const Q=await get('/api/performance?'+new URLSearchParams(base),{facade});
const teams=fastestTeamTelemetrySelections(Q.teams);
for(const subject of ['team','driver']){
  const selections=subject==='team'?teams:session.drivers.flatMap(d=>{
    const lap=d.laps.filter(l=>l.accurate&&!l.deleted&&!l.in_lap&&!l.out_lap&&Number.isFinite(l.time)).sort((a,b)=>a.time-b.time)[0];
    return lap?[{team:d.code,team_name:d.code,driver:d.code,driver_number:d.number,lap:lap.lap,time:lap.time,
      start:lap.lap_start_seconds,end:lap.lap_end_seconds,sectors:[lap.s1,lap.s2,lap.s3],compound:lap.compound,phase:lap.phase}]:[];
  });
  const batch=await get('/api/performance/trace-batch?'+new URLSearchParams({...base,windows:JSON.stringify(selections)}),{facade});
  if(batch.source_coverage?.received!==selections.length)throw Error('Missing native batch sources');
  const corners=await get('/api/qualifying-corners?'+new URLSearchParams({...base,subject}));
  if(corners.received!==corners.requested||corners.requestErrors?.length)throw Error('Qualifying lap requests failed');
  results.push({subject,native:batch.source_coverage,braking:Object.values(batch.teams).reduce((n,t)=>n+(t.braking?.length||0),0),
    straight:Object.values(batch.teams).filter(t=>Number.isFinite(t.straight_core_time)).length,
    corners:{requested:corners.requested,received:corners.received,traces:Object.keys(corners.traces||{}).length,
      markers:corners.markers?.length,complete:corners.complete}});
}
console.log(JSON.stringify(results,null,2));
if(process.argv[2])await writeFile(process.argv[2],JSON.stringify({origin,results},null,2));
