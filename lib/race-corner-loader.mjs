import {raceCornerGroups,measureRaceCornerGroup} from '../race-cornering.js';
import {circuitCornerMarkers,qualifyingRepresentatives} from '../corner-geometry.js';
import {RACE_VERSION,dataTTL} from './data-cache.mjs';
export async function loadRaceSnapshot(cache,{year,gp,round,lap,compound,subject='team',fresh=false}) {
  const base=new URLSearchParams({year,gp,round,session:'R'});
  const key=RACE_VERSION+':'+new URLSearchParams({year,gp,round,lap,compound,subject});
  return cache.result(key,async()=>{
    const [s,p]=await Promise.all([cache.get('/api/session?'+base,{fresh}),
      cache.get('/api/performance?'+new URLSearchParams({year,gp,session:'R'}),{fresh})]);
    const session={...s.data,year,event:gp};
    const preferred=Object.fromEntries((p.data.teams||[]).map(t=>[t.team,t.fastest_race_driver]));
    const group=raceCornerGroups(session,preferred,4,subject).find(g=>g.lap===lap&&g.compound===compound);
    if(!group)return {observations:[],complete:false,reason:'No matched green-flag cohort on this race lap and compound.',requestErrors:[]};
    const entries=[],requestErrors=[],jobs=[...group.rows];
    async function worker(){while(jobs.length){const row=jobs.shift(),params=new URLSearchParams(base);
      for(const [key,value] of Object.entries({driver:row.driver.code,driver_number:row.driver.number,lap:row.lap,lap_time:row.time,
        lap_start_seconds:row.lap_start_seconds,lap_end_seconds:row.lap_end_seconds}))params.set(key,String(value));
      if(session.openf1_session_key)params.set('session_key',session.openf1_session_key);
      try{const payload=await cache.get('/api/telemetry?'+params,{fresh});entries.push({row,payload:payload.data});}
      catch(error){requestErrors.push(row.driver.code+' L'+row.lap+': '+error.message);}
    }}
    await Promise.all([worker(),worker(),worker()]);
    let markers=entries.length?circuitCornerMarkers(entries[0].payload,session):[];
    let geometrySource='Race-lap circuit positions';
    if(!markers.length)markers=(session.corners||[]).filter(c=>Number.isFinite(c.fraction));
    if(!markers.length&&entries.length) {
      // A missing race GPS channel must not force every team's qualifying archive.
      // Reuse one validated same-circuit qualifying map as the documented fallback.
      const guide=await cache.result(RACE_VERSION+':geometry:'+year+':'+gp,async()=>{
        const query=new URLSearchParams({year,gp,round,session:'Q'});
        const reference={...(await cache.get('/api/session?'+query,{fresh})).data,year,event:gp};
        const row=qualifyingRepresentatives(reference,'driver').sort((a,b)=>a.time-b.time)[0];
        if(!row)return {markers:[]};
        for(const [key,value] of Object.entries({driver:row.driver.code,driver_number:row.driver.number,lap:row.lap,lap_time:row.time,
          lap_start_seconds:row.lap_start_seconds,lap_end_seconds:row.lap_end_seconds}))query.set(key,String(value));
        if(reference.openf1_session_key)query.set('session_key',reference.openf1_session_key);
        const telemetry=await cache.get('/api/telemetry?'+query,{fresh});
        return {markers:circuitCornerMarkers(telemetry.data,reference)};
      },{fresh,valid:data=>data.markers.length>=3,ttl:604800});
      markers=guide.data.markers;geometrySource='Same-circuit qualifying map · sector-registered race timing (approximate)';
    }
    const observations=measureRaceCornerGroup(entries,markers,session);
    return {observations:observations.map(o=>({...o,geometrySource})),requested:group.rows.length,received:entries.length,complete:observations.length>=3&&!requestErrors.length,
      requestErrors,geometrySource,reason:observations.length?'':`Received ${entries.length}/${group.rows.length} laps, but fewer than three support common circuit windows and valid timing.`,date:session.date};
  },{fresh,valid:data=>data.complete,ttl:data=>dataTTL('/api/session?'+base,data)});
}
