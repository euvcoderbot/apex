// Matched race observations, not a synthetic downforce or fuel correction.
import {circuitCornerMarkers} from './corner-geometry.js?v=20261007-coverage';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
const median=a=>{const s=[...a].sort((a,b)=>a-b),i=s.length>>1;return s.length?s.length%2?s[i]:(s[i-1]+s[i])/2:null;};
function fieldMinimumSpeed(measured,fraction,total) {
  const speeds=[];
  for(let metres=-25;metres<=25;metres+=5){const f=fraction+metres/total;
    const values=measured.map(e=>{const points=e.data.points,hi=points.findIndex(p=>p.f>=f);
      if(hi<1)return null;const a=points[hi-1],b=points[hi];
      return b.t-a.t<=1?a.v+(b.v-a.v)*(f-a.f)/(b.f-a.f):null;}).filter(finite);
    // One dropped channel must not veto a supported field classification.
    // Require a majority and at least three cars (two in a two-car view).
    const required=Math.max(Math.min(3,measured.length),Math.ceil(measured.length/2));
    if(values.length>=required&&values.length>=2)speeds.push(median(values));}
  return speeds.length?Math.min(...speeds):null;
}
export const RACE_SNAPSHOT_LIMIT=24;
export function raceCornerGroups(session,preferred={},limit=RACE_SNAPSHOT_LIMIT,subject='team') {
  const drivers=session.drivers||[], all=drivers.flatMap(d=>(d.laps||[]).map(l=>({...l,driver:d})));
  const completions=all.filter(l=>finite(l.lap_end_seconds)&&!l.in_lap&&!l.out_lap);
  const eligible=all.filter(l=>finite(l.time)&&l.lap>1&&!l.in_lap&&!l.out_lap&&!l.deleted&&l.accurate!==false&&l.track_status==='1'
    &&['SOFT','MEDIUM','HARD'].includes(l.compound)&&finite(l.tyre_life)&&!l.conditions?.rainfall
    &&finite(l.lap_start_seconds)&&finite(l.lap_end_seconds));
  const medians=new Map();
  for(const l of eligible){const key=l.driver.code+':'+l.stint;if(!medians.has(key))medians.set(key,median(eligible.filter(r=>r.driver===l.driver&&r.stint===l.stint).map(r=>r.time)));}
  const clean=eligible.filter(l=>l.time<=medians.get(l.driver.code+':'+l.stint)*1.07).filter(l=>{
    // An approximate traffic screen at the finish line, not full-lap clean air.
    const before=completions.filter(r=>r.driver!==l.driver&&r.lap_end_seconds<l.lap_end_seconds&&r.lap_end_seconds>l.lap_start_seconds);
    return !before.length || l.lap_end_seconds-Math.max(...before.map(r=>r.lap_end_seconds))>2;
  });
  const groups=[];
  for(const lap of [...new Set(clean.map(l=>l.lap))])for(const compound of ['SOFT','MEDIUM','HARD']) {
    const rows=clean.filter(l=>l.lap===lap&&l.compound===compound);
    const candidates=new Map();
    for(const pivot of rows){const matched=rows.filter(l=>l.tyre_life>=pivot.tyre_life&&l.tyre_life<=pivot.tyre_life+4);
      const byTeam=new Map();for(const l of matched){const identity=subject==='driver'?l.driver.code:l.driver.team,old=byTeam.get(identity);
        if(!old || l.driver.code===preferred[l.driver.team]&&old.driver.code!==preferred[l.driver.team]
          || (l.driver.code===preferred[l.driver.team])===(old.driver.code===preferred[l.driver.team])&&l.time<old.time)byTeam.set(identity,l);}
      const matchedRows=[...byTeam.values()].sort((a,b)=>a.driver.code.localeCompare(b.driver.code));
      if(matchedRows.length>=3)candidates.set(matchedRows.map(r=>r.driver.code).join(','),matchedRows);}
    // Keep distinct overlapping cohorts, rather than throwing away the bridge
    // between two tyre-age groups on the same race lap.
    for(const [cohort,rows] of candidates)if(![...candidates.values()].some(other=>other.length>rows.length&&rows.every(r=>other.includes(r))))
      groups.push({lap,compound,cohort,rows});
  }
  const selected=[],counts=new Map(),pairs=new Set(),buckets=new Set();
  const maxLap=Math.max(1,...all.map(l=>l.lap||0));
  const identity=r=>subject==='driver'?r.driver.code:r.driver.team;
  const pairKeys=g=>g.rows.flatMap((r,i)=>g.rows.slice(i+1).map(other=>[identity(r),identity(other)].sort().join(':')));
  const score=g=>g.rows.reduce((sum,r)=>sum+(!counts.has(identity(r))?100:10/(counts.get(identity(r))+1)),0)
    +pairKeys(g).filter(pair=>!pairs.has(pair)).length*15+(!buckets.has(Math.floor(g.lap/maxLap*4))?5:0);
  const pool=[...groups];
  while(pool.length&&selected.length<limit){
    pool.sort((a,b)=>score(b)-score(a)||a.lap-b.lap||a.compound.localeCompare(b.compound)||a.cohort.localeCompare(b.cohort));
    const g=pool.shift();selected.push(g);for(const r of g.rows)counts.set(identity(r),(counts.get(identity(r))||0)+1);
    pairKeys(g).forEach(pair=>pairs.add(pair));buckets.add(Math.floor(g.lap/maxLap*4));
  }
  return selected;
}

export function raceCornerAlignmentIssue(entry,markers,session={}) {
  const native=registered(entry);if(!native)return 'Native telemetry does not match the official lap timing or has invalid samples.';
  const own=circuitCornerMarkers(entry.payload,session);
  if(!own.length)return /selected lap/i.test(entry.payload.source||'')?'Unverified selected-archive origin without circuit positions.':null;
  const matching=markers.map(m=>[m,own.find(c=>c.label===m.label)]).filter(([,m])=>m);
  // A few missing GPS packets must not discard an otherwise verified lap.
  if(matching.length<3)return 'Too few named circuit positions verify the source-lap origin.';
  if(matching.some(([a,b])=>Math.abs(a.fraction-b.fraction)>.04))return 'Source lap is displaced on the circuit; official duration alone is not sufficient alignment.';
  return null;
}

function elapsedAt(points,fraction) {
  let hi=points.findIndex(p=>p.f>=fraction);if(hi<0)return null;if(!hi)return points[0].t;
  // Traversal uses cumulative timestamps, not differentiation of sparse speed.
  // Permit a short dropped packet, disclose its bracket, and keep braking stricter.
  const a=points[hi-1],b=points[hi];if(Math.max(b.t-a.t,a.sourceInterval||0,b.sourceInterval||0)>1.5||b.f<=a.f)return null;
  return a.t+(b.t-a.t)*(fraction-a.f)/(b.f-a.f);
}
function boundaryInterval(points,fraction) {
  const hi=points.findIndex(p=>p.f>=fraction);
  return hi>0?Math.max(points[hi].t-points[hi-1].t,points[hi].sourceInterval||0,points[hi-1].sourceInterval||0):null;
}
function fractionAtTime(points,t) {
  const hi=points.findIndex(p=>p.t>=t);if(hi<1)return hi===0?points[0].f:null;
  const a=points[hi-1],b=points[hi];return a.f+(b.f-a.f)*(t-a.t)/(b.t-a.t);
}
function registered(entry,ref) {
  const raw=entry.payload.samples||[];if(raw.length<30)return null;
  const origin=raw[0].ElapsedSeconds,d0=raw[0].Distance,total=raw.at(-1).Distance-d0;
  if(!(total>1000))return null;
  const points=raw.filter(p=>finite(p.Speed)&&finite(p.Distance)&&finite(p.ElapsedSeconds))
    .map(p=>({f:(p.Distance-d0)/total,t:p.ElapsedSeconds-origin,v:p.Speed,sourceInterval:p.SourceIntervalSeconds||0}));
  if(points.some((p,i)=>p.v<30||p.v>420||i>0&&i<points.length-1&&p.v>Math.max(points[i-1].v,points[i+1].v)+15&&p.v-Math.min(points[i-1].v,points[i+1].v)>25))return null;
  if(points.length<30||points.some((p,i)=>i&&(p.f<=points[i-1].f||p.t<=points[i-1].t||p.t-points[i-1].t>1.5)))return null;
  const official=entry.row.time,duration=points.at(-1).t;
  if(!finite(official)||official<=0)return null;
  if(Math.abs(duration-official)>1.5)return null;
  const sectors=[entry.row.s1,entry.row.s2,entry.row.s3];
  if(!sectors.every(s=>finite(s)&&s>0)||Math.abs(sectors.reduce((a,b)=>a+b,0)-official)>.1)return null;
  const source=[0,fractionAtTime(points,sectors[0]),fractionAtTime(points,sectors[0]+sectors[1]),1];
  const target=ref||source;if(source.some((f,i)=>!finite(f)||i&&f<=source[i-1]))return null;
  return {points:points.map(p=>{let i=0;while(i<2&&p.f>source[i+1])i++;
    const observed=[0,sectors[0],sectors[0]+sectors[1],duration],timed=[0,sectors[0],sectors[0]+sectors[1],official];
    let k=0;while(k<2&&p.t>observed[k+1])k++;
    return {...p,f:target[i]+(target[i+1]-target[i])*(p.f-source[i])/(source[i+1]-source[i]),t:timed[k]+(timed[k+1]-timed[k])*(p.t-observed[k])/(observed[k+1]-observed[k])};}),anchors:source,total};
}

export function measureRaceCornerGroup(entries,fallbackMarkers=[],session={}) {
  const ready=entries.map(e=>({...e,native:registered(e)})).filter(e=>e.native).sort((a,b)=>a.row.driver.code.localeCompare(b.row.driver.code));
  if(ready.length<3)return [];
  const ref=ready[0],ownMarkers=circuitCornerMarkers(ref.payload,session);
  const markers=(fallbackMarkers.length?fallbackMarkers:ownMarkers).filter(c=>finite(c.fraction)&&c.fraction>0&&c.fraction<1).sort((a,b)=>a.fraction-b.fraction);
  if(markers.length<3)return [];
  const measured=ready.filter(e=>!raceCornerAlignmentIssue(e,markers,session)).map(e=>{
    const local=circuitCornerMarkers(e.payload,session);
    if(!local.length)return {...e,data:registered(e,ref.native.anchors),alignment:'Official-sector registration · map-only approximation'};
    // Match the actual named circuit positions, not the time at sector lines.
    // Sector-only stretching cannot correct a trace cut at a different corner.
    const supported=markers.filter(m=>local.some(c=>c.label===m.label));
    const from=[0,...supported.map(m=>local.find(c=>c.label===m.label).fraction),1],to=[0,...supported.map(m=>m.fraction),1];
    const points=e.native.points.map(p=>{let i=0;while(i<from.length-2&&p.f>from[i+1])i++;
      return {...p,f:to[i]+(to[i+1]-to[i])*(p.f-from[i])/(from[i+1]-from[i])};});
    return {...e,data:{...e.native,points},alignment:supported.length===markers.length?'Named circuit-position registration':`Named circuit-position registration · ${supported.length}/${markers.length} GPS landmarks`};
  }).filter(e=>e.data);
  if(measured.length<3)return [];
  const zones=markers.map((m,i)=>{
    const left=i?(markers[i-1].fraction+m.fraction)/2:0,right=i<markers.length-1?(m.fraction+markers[i+1].fraction)/2:1;
    const start=Math.max(left,m.fraction-130/ref.native.total),end=Math.min(right,m.fraction+100/ref.native.total);
    const apex=fieldMinimumSpeed(measured,m.fraction,ref.native.total);return {start,end,corner:m.label,band:finite(apex)?apex<=120?'low':apex<=200?'medium':'high':null};
  });
  // Every entrant in this observation must support the same corner windows.
  const rows=measured.map(e=>{const times=zones.map(z=>{const points=e.data.points.filter(p=>p.f>=z.start&&p.f<=z.end);
    if(points.length<3)return null;
    const a=elapsedAt(e.data.points,z.start),b=elapsedAt(e.data.points,z.end);return finite(a)&&finite(b)?b-a:null;});
    return times.every(t=>finite(t)&&t>0)?{team:e.row.driver.team,color:e.row.driver.team_color,driver:e.row.driver.code,lap:e.row.lap,tyreAge:e.row.tyre_life,lapTime:e.row.time,times,alignment:e.alignment}:null;}).filter(Boolean);
  if(rows.length<3)return [];
  return rows.map(row=>{const values={};for(const band of ['all','low','medium','high']){
    const indices=zones.map((z,i)=>band==='all'||z.band===band?i:-1).filter(i=>i>=0);
    const own=mean(indices.map(i=>row.times[i]));const fastest=Math.min(...rows.map(r=>mean(indices.map(i=>r.times[i]))).filter(finite));
    values[band]=indices.length?Math.max(0,own-fastest):null;}
    return {...row,values,corners:zones.length,cornerBands:zones.map(z=>({corner:z.corner,band:z.band})),compound:entries[0].row.compound};});
}

// Snapshot fixed effects: each comparison is within one race lap, compound and
// narrow tyre-age cohort. Overlapping entrants connect snapshots; disjoint
// components are never given a shared zero. This is an estimate, not a direct
// all-field comparison, and support is exposed beside the score.
export function connectedRaceCornerScores(observations,band='all',subject='team',stat='mean') {
  const id=o=>subject==='driver'?o.driver:o.team,groups=new Map(),metadata=new Map();
  for(const o of observations)if(finite(o.values?.[band])){
    const key=o.snapshot||o.lap+':'+o.compound;if(!groups.has(key)){groups.set(key,new Map());metadata.set(key,new Map());}
    groups.get(key).set(id(o),o.values[band]);metadata.get(key).set(id(o),o);}
  const graph=new Map();for(const group of groups.values())if(group.size>=3)for(const name of group.keys()){
    if(!graph.has(name))graph.set(name,new Set());for(const peer of group.keys())graph.get(name).add(peer);}
  const unseen=new Set(graph.keys()),components=[];
  while(unseen.size){const found=new Set(),todo=[unseen.values().next().value];while(todo.length){const name=todo.pop();if(found.has(name))continue;
    found.add(name);unseen.delete(name);for(const peer of graph.get(name)||[])if(!found.has(peer))todo.push(peer);}components.push([...found].sort());}
  components.sort((a,b)=>b.length-a.length||a.join().localeCompare(b.join()));
  const scores=new Map(),support=new Map(),component=components[0]||[],names=new Set(component);
  const blocks=[...groups].filter(([,g])=>g.size>=3&&[...g.keys()].every(name=>names.has(name)));
  const pairs=new Map();
  for(const [snapshot,g] of blocks){const entrants=[...g.keys()].sort();
    for(const name of entrants)support.set(name,(support.get(name)||0)+1);
    for(let i=0;i<entrants.length;i++)for(let j=i+1;j<entrants.length;j++){
      const a=entrants[i],b=entrants[j],key=a+'\0'+b;if(!pairs.has(key))pairs.set(key,{a,b,values:[],weights:[],seen:new Set()});
      const p=pairs.get(key),oa=metadata.get(snapshot).get(a),ob=metadata.get(snapshot).get(b);
      const physical=finite(oa.lap)&&finite(ob.lap)?oa.lap+':'+oa.compound+':'+oa.driver+':'+ob.driver:snapshot;
      // The same two physical laps may occur in overlapping age cohorts. They
      // are one contrast, not extra evidence just because a third rival differs.
      if(p.seen.has(physical))continue;p.seen.add(physical);
      p.values.push(g.get(a)-g.get(b));p.weights.push(1/entrants.length);
    }
  }
  const n=component.length,index=new Map(component.map((name,i)=>[name,i])),matrix=Array.from({length:n},()=>Array(n).fill(0)),rhs=Array(n).fill(0),contrasts=[];
  for(const p of pairs.values()){
    const weight=p.weights.reduce((a,b)=>a+b,0),delta=stat==='median'?median(p.values):p.values.reduce((sum,v,i)=>sum+v*p.weights[i],0)/weight;
    const a=index.get(p.a),b=index.get(p.b);matrix[a][a]+=weight;matrix[b][b]+=weight;matrix[a][b]-=weight;matrix[b][a]-=weight;
    rhs[a]+=weight*delta;rhs[b]-=weight*delta;contrasts.push({a,b,weight,delta});
  }
  // One anchor fixes the arbitrary shared baseline. Solve the graph Laplacian
  // directly; alternating medians can get stuck at a non-optimal fixed point.
  const system=matrix.slice(1).map((row,i)=>[...row.slice(1),rhs[i+1]]);
  for(let column=0;column<n-1;column++){
    let pivot=column;for(let row=column+1;row<n-1;row++)if(Math.abs(system[row][column])>Math.abs(system[pivot][column]))pivot=row;
    [system[pivot],system[column]]=[system[column],system[pivot]];
    const scale=system[column][column];if(Math.abs(scale)<1e-12)return {scores,support,components,snapshots:blocks.length};
    for(let k=column;k<n;k++)system[column][k]/=scale;
    for(let row=0;row<n-1;row++)if(row!==column){const factor=system[row][column];for(let k=column;k<n;k++)system[row][k]-=factor*system[column][k];}
  }
  const effects=[0,...system.map(row=>row[n-1])],fastest=Math.min(...effects);
  component.forEach((name,i)=>scores.set(name,effects[i]-fastest));
  const residual=contrasts.length?Math.sqrt(contrasts.reduce((sum,c)=>sum+c.weight*(effects[c.a]-effects[c.b]-c.delta)**2,0)/contrasts.reduce((sum,c)=>sum+c.weight,0)):null;
  return {scores,support,components,snapshots:blocks.length,residual};
}

export function measureQualifyingCornerGroup(entries,session={}) {
  const ready=entries.map(e=>({...e,native:registered(e)})).filter(e=>e.native).sort((a,b)=>a.row.time-b.row.time);
  if(ready.length<2)return {traces:{},markers:[],error:'At least two complete qualifying laps are required.'};
  const ref=ready[0],markers=circuitCornerMarkers(ref.payload,session);
  if(markers.length<3)return {traces:{},markers,error:'Circuit markers could not be matched to this lap. No speed-dip substitute is used.'};
  const measured=ready.map(e=>({...e,data:registered(e,ref.native.anchors)})).filter(e=>e.data);
  const classification=measured.filter(e=>!session.cornerClassificationDrivers||session.cornerClassificationDrivers.includes(e.row.driver.code));
  const zones=markers.map((m,i)=>{
    const left=i?(markers[i-1].fraction+m.fraction)/2:0,right=i<markers.length-1?(m.fraction+markers[i+1].fraction)/2:1;
    const start=Math.max(left,m.fraction-130/ref.native.total),end=Math.min(right,m.fraction+100/ref.native.total);
    // Match Python: minimum of the field-median trace on a fixed 5 m grid,
    // not median of independently located minima (a different statistic).
    const speed=fieldMinimumSpeed(classification,m.fraction,ref.native.total);
    return {start,end,apex:m.fraction,corner:m.label,speed,band:finite(speed)?speed<=120?'low':speed<=200?'medium':'high':null};
  });
  const unclassified=zones.filter(z=>!z.band).map(z=>z.corner);
  const time=(data,z)=>{const points=data.points.filter(p=>p.f>=z.start&&p.f<=z.end);
    if(points.length<3)return null;
    const a=elapsedAt(data.points,z.start),b=elapsedAt(data.points,z.end);return finite(a)&&finite(b)&&b>a?b-a:null;};
  const refTimes=zones.map(z=>time(ref.native,z)),traces={};
  for(const e of measured) {
    const corners=zones.flatMap((z,i)=>{
      const t=time(e.data,z);if(!finite(t)||!finite(refTimes[i]))return [];
      const local=e.data.points.filter(p=>p.f>=z.start&&p.f<=z.end),reference=ref.native.points.filter(p=>p.f>=z.start&&p.f<=z.end);
      const minimum=Math.min(...local.map(p=>p.v)),refMinimum=Math.min(...reference.map(p=>p.v)),length=(z.end-z.start)*ref.native.total;
      return [{corner:z.corner,band:z.band,tercile_label:z.band?z.band+'-speed':'Unclassified',time:t,ref_time:refTimes[i],time_lost:t-refTimes[i],length,
        mean_speed:length/t*3.6,loss_density:(t-refTimes[i])/length*100000,minimum,
        entry_speed:local[0].v,exit_speed:local.at(-1).v,delta_entry:local[0].v-reference[0].v,
        delta_apex:minimum-refMinimum,delta_exit:local.at(-1).v-reference.at(-1).v,
        boundary_interval_s:Math.max(...[boundaryInterval(e.data.points,z.start),boundaryInterval(e.data.points,z.end),
          boundaryInterval(ref.native.points,z.start),boundaryInterval(ref.native.points,z.end)].filter(finite)),
        apex_distance:z.apex*ref.native.total,source:'circuit-marker-window'}];
    });
    const categories={},corner_band_coverage={};
    for(const band of ['low','medium','high']) {
      const expected=zones.filter(z=>z.band===band),own=corners.filter(c=>c.band===band);
      corner_band_coverage[band]={measured:own.length,expected:expected.length,missing:expected.filter(z=>!own.some(c=>c.corner===z.corner)).map(z=>z.corner)};
      const seconds=own.reduce((s,c)=>s+c.time,0),lost=own.reduce((s,c)=>s+c.time_lost,0);
      categories[band]=!unclassified.length&&expected.length&&own.length===expected.length?{time:seconds,time_lost:lost,deficit:lost/ref.row.time*100,corners:own.length,
        speed:own.reduce((s,c)=>s+c.length,0)/seconds*3.6}:null;
    }
    const selection={driver:e.row.driver.code,lap:e.row.lap,time:e.row.time,phase:e.row.phase,compound:e.row.compound};
    const cornerTime=corners.length===zones.length?corners.reduce((s,c)=>s+c.time,0):null;
    const contribution=corners.length===zones.length?corners.reduce((s,c)=>s+c.time_lost,0)/ref.row.time*100:null;
    traces[e.row.driver.code]={corners,categories,corner_band_coverage,selection,lap_distance:ref.native.total,
      reference_lap_time:ref.row.time,corner_time:cornerTime,straight_time:finite(cornerTime)?e.row.time-cornerTime:null,
      straight_contribution:finite(contribution)?(e.row.time/ref.row.time-1)*100-contribution:null,
      straight_traversal_delta:finite(contribution)?(e.row.time/ref.row.time-1)*100-contribution:null,
      corner_contribution:contribution,corner_provisional:corners.some(c=>c.boundary_interval_s>.6),
      lap_gap:(e.row.time/ref.row.time-1)*100,corner_method:'circuit-marker-windows',corner_expected:zones.length,
      corner_missing:zones.filter(z=>!corners.some(c=>c.corner===z.corner)).map(z=>z.corner)};
  }
  return {traces,markers:zones,reference:ref.row.driver.code,error:unclassified.length?`Corner speed classification unavailable at ${unclassified.join(', ')}; valid timing windows retained, speed-band rankings unavailable.`:null};
}
