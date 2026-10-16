import {raceCornerGroups,measureRaceCornerGroup,raceCornerAlignmentIssue,RACE_SNAPSHOT_LIMIT} from '../race-cornering.js';
import {circuitCornerMarkers,qualifyingRepresentatives} from '../corner-geometry.js';
import {RACE_VERSION,dataTTL} from './data-cache.mjs';
export async function loadCachedRaceSnapshots(cache,{year,gp,round,subject='team',model='matched',fresh=false}) {
  const extra=model==='matched'?{}:{model};
  const plan=await loadRaceCornerPlan(cache,{year,gp,round,subject,model,fresh});
  const {groups,entrants}=plan.data;
  const hits=await Promise.all(groups.map(async g=>{
    const hit=await cache.peek(RACE_VERSION+':'+new URLSearchParams({year,gp,round,lap:g.lap,compound:g.compound,cohort:g.cohort,subject,...extra}));
    return hit?.data.complete?{lap:g.lap,compound:g.compound,cohort:g.cohort,snapshot:hit.data,ttl:hit.ttl}:null;
  }));
  const snapshots=hits.filter(Boolean);
  return {data:{snapshots,total:groups.length,groups,entrants,plan:plan.data.plan,source_coverage:plan.data.source_coverage,model},cache:snapshots.length?'HIT':'MISS',ttl:snapshots.length===groups.length&&groups.length?Math.min(...snapshots.map(h=>h.ttl)):0};
}
export async function loadRaceCornerPlan(cache,{year,gp,round='',subject='team',fresh=false,model='matched'}){
  return cache.result(RACE_VERSION+':plan:'+new URLSearchParams({year,gp,round,subject,...(model==='matched'?{}:{model})}),async()=>{
    const [s,p]=await Promise.all([cache.get('/api/session?'+new URLSearchParams({year,gp,round,session:'R'}),{fresh}),cache.get('/api/performance?'+new URLSearchParams({year,gp,session:'R'}),{fresh}).catch(()=>({data:{teams:[]}}))]);
    const session={...s.data,year,event:gp},preferred=Object.fromEntries((p.data.teams||[]).map(t=>[t.team,t.fastest_race_driver]));
    const recorded=session.source_cache?.kind==='verified-recording'&&Array.isArray(session.available_telemetry);
    const available=new Set((session.available_telemetry||[]).map(r=>r.driver+':'+r.lap));
    // A retained timing session is not proof that live telemetry is absent.
    // Probe one eligible non-retained lap before restricting the entire race
    // to the small offline inventory. The successful raw response is cached
    // under the same identity used by snapshot workers.
    const full=raceCornerGroups(session,preferred,RACE_SNAPSHOT_LIMIT,subject,model);
    let liveAvailable=!recorded,probeError=null;
    const probe=recorded?full.flatMap(g=>g.rows).find(r=>!available.has(r.driver.code+':'+r.lap)):null;
    if(probe){
      const query=new URLSearchParams({year,gp,round,session:'R',driver:probe.driver.code,driver_number:probe.driver.number,
        lap:probe.lap,lap_time:probe.time,lap_start_seconds:probe.lap_start_seconds,lap_end_seconds:probe.lap_end_seconds});
      if(session.openf1_session_key)query.set('session_key',session.openf1_session_key);
      try{
        let payload;
        if(year>=2023&&session.openf1_session_key){
          const batch=(await cache.get('/api/performance/race-laps?'+new URLSearchParams({year,gp,driver_number:probe.driver.number,session_key:session.openf1_session_key}),{fresh})).data;
          const lap=batch.laps.find(l=>l.lap===probe.lap);
          if(!lap||Math.abs(lap.time-probe.time)>1.5)throw new Error('Native race stream does not support the selected official lap.');
          payload={source:batch.source,samples:lap.points.map(values=>Object.fromEntries(batch.columns.map((key,i)=>[key,values[i]])))};
        }else payload=(await cache.get('/api/telemetry?'+query,{fresh})).data;
        const issue=raceCornerAlignmentIssue({row:probe,payload},circuitCornerMarkers(payload,session),session);
        if(issue)throw new Error(issue);
        liveAvailable=true;
      }catch(error){probeError=error.message;}
    }
    const sourceLimited=recorded&&!liveAvailable;
    const selected=sourceLimited?raceCornerGroups(session,preferred,RACE_SNAPSHOT_LIMIT,subject,model,available):full,seen=new Set();
    const groups=selected.flatMap(g=>{
      const rows=sourceLimited?g.rows.filter(r=>available.has(r.driver.code+':'+r.lap)):g.rows;
      if(rows.length<3)return [];
      const cohort=rows.map(r=>r.driver.code).sort().join(','),key=g.lap+':'+g.compound+':'+cohort;
      if(seen.has(key))return [];seen.add(key);
      return [{...g,cohort,rows:rows.map(({driver,...row})=>({...row,driver:{code:driver.code,number:driver.number,team:driver.team,team_color:driver.team_color}}))}];
    });
    return {groups,plan:{...selected.plan,sourceLimited,selectedGroups:groups.length},source_coverage:recorded?{kind:sourceLimited?'recorded-native-only':'live-native-with-retained-fallback',laps:available.size,
      plannedDriverLaps:selected.plan.selectedUniqueLaps,probeError,
      message:sourceLimited?'Live native-lap retrieval failed; using retained race laps. Refresh data retries the source. Missing laps are not reconstructed from lap times.':
        'Live native telemetry verified beyond the retained inventory. All eligible matched race groups are loaded and cached; timing records alone are never used to invent corner times.'}:null,
      session:{year,event:gp,date:session.date,location:session.location,circuit_key:session.circuit_key,corners:session.corners,openf1_session_key:session.openf1_session_key,available_telemetry:session.available_telemetry},
      entrants:(session.drivers||[]).map(d=>({team:subject==='driver'?d.code:d.team,displayName:subject==='driver'?d.code:d.team,logoTeam:d.team,color:d.team_color})),date:session.date,source_cache:session.source_cache};
  },{fresh,valid:data=>data.groups.length>0,ttl:data=>dataTTL('/api/session?'+new URLSearchParams({year,gp,session:'R'}),data)});
}
export async function loadRaceSnapshot(cache,{year,gp,round,lap,compound,cohort='',subject='team',fresh=false,model='matched'}) {
  const base=new URLSearchParams({year,gp,round,session:'R'});
  const key=RACE_VERSION+':'+new URLSearchParams({year,gp,round,lap,compound,cohort,subject,...(model==='matched'?{}:{model})});
  return cache.result(key,async()=>{
    const plan=await loadRaceCornerPlan(cache,{year,gp,round,subject,model,fresh}),session=plan.data.session;
    const group=plan.data.groups.find(g=>g.lap===lap&&g.compound===compound&&(!cohort||g.cohort===cohort));
    if(!group)return {observations:[],complete:false,reason:'No matched green-flag cohort on this race lap and compound.',requestErrors:[]};
    const entries=[],requestErrors=[],jobs=[...group.rows];let sourcePaused=false;
    async function worker(){while(jobs.length){const row=jobs.shift(),params=new URLSearchParams(base);
      for(const [key,value] of Object.entries({driver:row.driver.code,driver_number:row.driver.number,lap:row.lap,lap_time:row.time,
        lap_start_seconds:row.lap_start_seconds,lap_end_seconds:row.lap_end_seconds}))params.set(key,String(value));
      if(session.openf1_session_key)params.set('session_key',session.openf1_session_key);
      try{
        let payload;
        if(year>=2023&&session.openf1_session_key){
          try{
            const batch=(await cache.get('/api/performance/race-laps?'+new URLSearchParams({year,gp,driver_number:row.driver.number,session_key:session.openf1_session_key}),{fresh})).data;
            const lap=batch.laps.find(l=>l.lap===row.lap);
            if(!lap)throw new Error('No supported native samples in the driver race stream for this lap.');
            if(Math.abs(lap.time-row.time)>1.5)throw new Error('Native lap duration does not match the official timing record.');
            payload={source:batch.source,samples:lap.points.map(values=>Object.fromEntries(batch.columns.map((key,i)=>[key,values[i]])))};
          }catch(error){
            if(error.status===429||/429|rate limit/i.test(error.message))sourcePaused=true;
            if(!session.available_telemetry?.some(l=>l.driver===row.driver.code&&l.lap===row.lap))throw error;
            payload=(await cache.get('/api/telemetry?'+params,{fresh:false})).data;
          }
        }else payload=(await cache.get('/api/telemetry?'+params,{fresh})).data;
        entries.push({row,payload});
      }catch(error){requestErrors.push(row.driver.code+' L'+row.lap+': '+error.message);}
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
      if(entry.payload.source_cache?.kind==='verified-recording'&&!fresh){
        // The automatic offline plan cannot repair a known retained alignment
        // failure by downloading the same recording again. Explicit refresh
        // may still try the live archive; unsupported data is never ranked.
        requestErrors.push(entry.row.driver.code+' L'+entry.row.lap+': '+issue);return;
      }
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
    const tagged=rows=>rows.map(o=>({...o,geometrySource,snapshot:lap+':'+compound+':'+group.cohort+':'+(o.cornerIds||[]).join(',')}));
    return {observations:tagged(observations),requested:group.rows.length,received:entries.length,sourcePaused,retryAfterSeconds:sourcePaused?60:0,complete:observations.length>=3&&!requestErrors.length,
      requestErrors,geometrySource,reason:observations.length?'':`Received ${entries.length}/${group.rows.length} laps, but fewer than three support common circuit windows and valid timing.`,date:session.date,source_cache:plan.data.source_cache};
  },{fresh,valid:data=>data.complete,ttl:data=>dataTTL('/api/session?'+base,data)});
}
