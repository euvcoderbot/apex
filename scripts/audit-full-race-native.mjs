import {raceCornerGroups,measureRaceCornerGroup,raceCornerAlignmentIssue} from '../race-cornering.js';
import {circuitCornerMarkers} from '../corner-geometry.js';
const base='https://apex-telemetry-api.vercel.app',year=2026,gp=process.argv[2]||'Singapore Grand Prix';
const session={...await(await fetch(base+'/api/session?'+new URLSearchParams({year,gp,session:'R'}))).json(),year,event:gp};
const recorded=new Set((session.available_telemetry||[]).map(r=>r.driver+':'+r.lap));
const groups=raceCornerGroups(session,{},Infinity,'team');
const group=groups.filter(g=>g.rows.filter(r=>!recorded.has(r.driver.code+':'+r.lap)).length>=3).sort((a,b)=>b.rows.length-a.rows.length)[0];
const entries=[];
await Promise.all(group.rows.map(async row=>{
 const params=new URLSearchParams({year,gp,session:'R',driver:row.driver.code,driver_number:row.driver.number,lap:row.lap,
  lap_time:row.time,lap_start_seconds:row.lap_start_seconds,lap_end_seconds:row.lap_end_seconds,session_key:session.openf1_session_key});
 const r=await fetch(base+'/api/telemetry?'+params,{signal:AbortSignal.timeout(55000)}),payload=await r.json();
 console.log(JSON.stringify({driver:row.driver.code,lap:row.lap,status:r.status,samples:payload.samples?.length,source:payload.source,detail:payload.detail}));
 if(r.ok&&payload.samples)entries.push({row,payload});
}));
const markers=entries.map(e=>circuitCornerMarkers(e.payload,session)).sort((a,b)=>b.length-a.length)[0]||[];
console.log(JSON.stringify({groups:groups.length,plan:groups.plan,lap:group.lap,markers:markers.length,
 alignment:entries.map(e=>[e.row.driver.code,raceCornerAlignmentIssue(e,markers,session)]),
 measured:measureRaceCornerGroup(entries,markers,session).map(o=>({driver:o.driver,corners:o.corners,lap:o.lap}))}));
