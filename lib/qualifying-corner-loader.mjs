import {qualifyingRepresentatives} from '../corner-geometry.js';
import {measureQualifyingCornerGroup} from '../race-cornering.js';
import {RACE_VERSION,dataTTL} from './data-cache.mjs';

// Cache measured results, not just raw telemetry. This shared server calculation
// avoids downloading and parsing every native lap again on each browser visit.
export async function loadQualifyingCorners(cache,{year,gp,round='',subject='team',fresh=false}) {
  const key=RACE_VERSION+':qualifying:'+new URLSearchParams({year,gp,round,subject});
  const previous=fresh?(await cache.peek(key))?.data:null;
  return cache.result(key,async()=>{
    const query=new URLSearchParams({year,gp,round,session:'Q'});
    const [s,p]=await Promise.all([cache.get('/api/session?'+query),cache.get('/api/performance?'+new URLSearchParams({year,gp,session:'Q'}))]);
    const session={...s.data,year,event:gp};
    const rows=qualifyingRepresentatives(session,subject,p.data.teams);
    const entries=[],errors=[],jobs=[...rows];
    async function worker(){while(jobs.length){const row=jobs.shift(),q=new URLSearchParams(query);
      for(const [name,value] of Object.entries({driver:row.driver.code,driver_number:row.driver.number,lap:row.lap,lap_time:row.time,
        lap_start_seconds:row.lap_start_seconds,lap_end_seconds:row.lap_end_seconds}))if(value!=null)q.set(name,String(value));
      if(session.openf1_session_key)q.set('session_key',session.openf1_session_key);
      const missing=fresh&&(!previous?.traces?.[row.driver.code]||previous.traces[row.driver.code].corner_missing?.length);
      try{entries.push({row,payload:(await cache.get('/api/telemetry?'+q,{fresh:missing,priority:1})).data});}
      catch(error){errors.push({driver:row.driver.code,reason:error.message});}
    }}
    await Promise.all([worker(),worker(),worker(),worker()]);
    const cornerClassificationDrivers=qualifyingRepresentatives(session,'team',p.data.teams).map(r=>r.driver.code);
    const measured=measureQualifyingCornerGroup(entries,{...session,cornerClassificationDrivers});
    const legacy=measureQualifyingCornerGroup(entries,{...session,cornerClassificationDrivers,cornerWindowMode:'legacy'});
    const entrants=subject==='team'?(p.data.teams||[]).map(t=>({team:t.team,driver:t.lap?.driver,displayName:t.team,logoTeam:t.team,color:t.color,lap:t.lap})):
      rows.map(r=>({team:r.driver.code,driver:r.driver.code,displayName:r.driver.name,logoTeam:r.driver.team,color:r.driver.team_color,
        lap:{driver:r.driver.code,number:r.driver.number,lap:r.lap,time:r.time,phase:r.phase,compound:r.compound}}));
    return {...measured,legacyTraces:legacy.traces,entrants,requested:rows.length,received:entries.length,requestErrors:errors,date:session.date,
      complete:errors.length===0&&rows.every(r=>measured.traces[r.driver.code]&&!measured.traces[r.driver.code].corner_missing?.length)};
  },{fresh,valid:data=>Object.keys(data.traces||{}).length>0,
    ttl:data=>data.complete?dataTTL('/api/session?'+new URLSearchParams({year,gp,session:'Q'}),data):120});
}
