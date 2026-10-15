import {raceCornerGroups,measureRaceCornerGroup,raceCornerAlignmentIssue,RACE_SNAPSHOT_LIMIT} from '../race-cornering.js';
import {circuitCornerMarkers,qualifyingRepresentatives} from '../corner-geometry.js';
import {RACE_VERSION,dataTTL} from './data-cache.mjs';
export async function loadCachedRaceSnapshots(cache,{year,gp,round,subject='team',model='matched'}) {
  const extra=model==='matched'?{}:{model};
  const plan=await loadRaceCornerPlan(cache,{year,gp,round,subject,model});
  const {groups,entrants}=plan.data;
  const hits=await Promise.all(groups.map(async g=>{
    const hit=await cache.peek(RACE_VERSION+':'+new URLSearchParams({year,gp,round,lap:g.lap,compound:g.compound,cohort:g.cohort,subject,...extra}));
    return hit?.data.complete?{lap:g.lap,compound:g.compound,cohort:g.cohort,snapshot:hit.data,ttl:hit.ttl}:null;
  }));
  const snapshots=hits.filter(Boolean);
  return {data:{snapshots,total:groups.length,groups,entrants,plan:plan.data.plan,model},cache:snapshots.length?'HIT':'MISS',ttl:snapshots.length===groups.length&&groups.length?Math.min(...snapshots.map(h=>h.ttl)):0};
}
export async function loadRaceCornerPlan(cache,{year,gp,round='',subject='team',fresh=false,model='matched'}){
  return cache.result(RACE_VERSION+':plan:'+new URLSearchParams({year,gp,round,subject,...(model==='matched'?{}:{model})}),async()=>{
    const [s,p]=await Promise.all([cache.get('/api/session?'+new URLSearchParams({year,gp,round,session:'R'})),cache.get('/api/performance?'+new URLSearchParams({year,gp,session:'R'}))]);
    const session={...s.data,year,event:gp},preferred=Object.fromEntries((p.data.teams||[]).map(t=>[t.team,t.fastest_race_driver]));
    const selected=raceCornerGroups(session,preferred,RACE_SNAPSHOT_LIMIT,subject,model);
    const groups=selected.map(g=>({...g,rows:g.rows.map(({driver,...row})=>({...row,driver:{code:driver.code,number:driver.number,team:driver.team,team_color:driver.team_color}}))}));
    return {groups,plan:selected.plan,session:{year,event:gp,date:session.date,location:session.location,circuit_key:session.circuit_key,corners:session.corners,openf1_session_key:session.openf1_session_key},
      entrants:(session.drivers||[]).map(d=>({team:subject==='driver'?d.code:d.team,displayName:subject==='driver'?d.code:d.team,logoTeam:d.team,color:d.team_color})),date:session.date};
  },{fresh,valid:data=>data.groups.length>0,ttl:data=>dataTTL('/api/session?'+new URLSearchParams({year,gp,session:'R'}),data)});
}
export async function loadRaceSnapshot(cache,{year,gp,round,lap,compound,cohort='',subject='team',fresh=false,model='matched'}) {
  const base=new URLSearchParams({year,gp,round,session:'R'});
  const key=RACE_VERSION+':'+new URLSearchParams({year,gp,round,lap,compound,cohort,subject,...(model==='matched'?{}:{model})});
  return cache.result(key,async()=>{
    const plan=await loadRaceCornerPlan(cache,{year,gp,round,subject,model}),session=plan.data.session;
    const group=plan.data.groups.find(g=>g.lap===lap&&g.compound===compound&&(!cohort||g.cohort===cohort));
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
    let markers=[],geometrySource='Same-circuit qualifying map · named race circuit positions';
    if(entries.length) {
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
        const markers=circuitCornerMarkers(telemetry.data,reference);
        const samples=telemetry.data.samples,total=samples.at(-1).Distance-samples[0].Distance;
        return {markers:markers.map(m=>{const d=samples[0].Distance+m.fraction*total,i=samples.findIndex(p=>p.Distance>=d);
          const a=samples[Math.max(0,i-1)],b=samples[Math.max(0,i)];
          return {...m,classification_speed:i>0&&b.ElapsedSeconds-a.ElapsedSeconds<=.6?a.Speed+(b.Speed-a.Speed)*(d-a.Distance)/(b.Distance-a.Distance):null};})};
      },{fresh,valid:data=>data.markers.length>=3,ttl:604800}).catch(()=>({data:{markers:[]}}));
      markers=guide.data.markers;
    }
    if(!markers.length){markers=entries.map(e=>circuitCornerMarkers(e.payload,session)).sort((a,b)=>b.length-a.length)[0]||[];geometrySource='Race-lap named circuit positions';}
    if(!markers.length){markers=(session.corners||[]).filter(c=>Number.isFinite(c.fraction));geometrySource='Official-sector registration · map-only approximation';}
    // Recover displaced fallback archives once, without sending every valid lap
    // through an uncached source reload. Omit cross-source relative boundaries.
    await Promise.all(entries.map(async entry=>{
      let issue=raceCornerAlignmentIssue(entry,markers,session);if(!issue)return;
      const query=new URLSearchParams(base);query.set('driver',entry.row.driver.code);query.set('driver_number',entry.row.driver.number);
      query.set('lap',entry.row.lap);query.set('lap_time',entry.row.time);
      if(session.openf1_session_key)query.set('session_key',session.openf1_session_key);
      try{
        entry.payload=(await cache.get('/api/telemetry?'+query,{fresh})).data;issue=raceCornerAlignmentIssue(entry,markers,session);
        if(issue){entry.payload=(await cache.get('/api/telemetry?'+query,{fresh:true})).data;issue=raceCornerAlignmentIssue(entry,markers,session);}
      }
      catch(error){issue+=' Recovery failed: '+error.message;}
      if(issue)requestErrors.push(entry.row.driver.code+' L'+entry.row.lap+': '+issue);
    }));
    const observations=measureRaceCornerGroup(entries,markers,session);
    const legacyObservations=measureRaceCornerGroup(entries,markers,{...session,cornerWindowMode:'legacy'});
    const tagged=rows=>rows.map(o=>({...o,geometrySource,snapshot:lap+':'+compound+':'+group.cohort+':'+(o.cornerIds||[]).join(',')}));
    return {observations:tagged(observations),legacyObservations:tagged(legacyObservations),requested:group.rows.length,received:entries.length,complete:observations.length>=3&&!requestErrors.length,
      requestErrors,geometrySource,reason:observations.length?'':`Received ${entries.length}/${group.rows.length} laps, but fewer than three support common circuit windows and valid timing.`,date:session.date};
  },{fresh,valid:data=>data.complete,ttl:data=>dataTTL('/api/session?'+base,data)});
}
