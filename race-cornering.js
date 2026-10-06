// Matched race observations, not a synthetic downforce or fuel correction.
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
const median=a=>{const s=[...a].sort((a,b)=>a-b),i=s.length>>1;return s.length?s.length%2?s[i]:(s[i-1]+s[i])/2:null;};
export function raceCornerGroups(session,preferred={},limit=4) {
  const drivers=session.drivers||[], all=drivers.flatMap(d=>(d.laps||[]).map(l=>({...l,driver:d})));
  const completions=all.filter(l=>finite(l.lap_end_seconds)&&!l.in_lap&&!l.out_lap);
  const eligible=all.filter(l=>finite(l.time)&&l.lap>1&&!l.in_lap&&!l.out_lap&&l.track_status==='1'
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
    let best=[];
    for(const pivot of rows){const matched=rows.filter(l=>Math.abs(l.tyre_life-pivot.tyre_life)<=2);
      const byTeam=new Map();for(const l of matched){const old=byTeam.get(l.driver.team);
        if(!old || l.driver.code===preferred[l.driver.team]&&old.driver.code!==preferred[l.driver.team]
          || (l.driver.code===preferred[l.driver.team])===(old.driver.code===preferred[l.driver.team])&&l.time<old.time)byTeam.set(l.driver.team,l);}
      if(byTeam.size>best.length)best=[...byTeam.values()];}
    if(best.length>=3)groups.push({lap,compound,rows:best});
  }
  const selected=[];
  const maxLap=Math.max(1,...all.map(l=>l.lap||0));
  for(let bucket=0;bucket<limit;bucket++){
    const pool=groups.filter(g=>Math.min(limit-1,Math.floor(g.lap/maxLap*limit))===bucket);
    pool.sort((a,b)=>b.rows.length-a.rows.length||a.lap-b.lap);
    if(pool.length)selected.push(pool[0]);
  }
  return selected;
}

function elapsedAt(points,fraction) {
  let hi=points.findIndex(p=>p.f>=fraction);if(hi<0)return null;if(!hi)return points[0].t;
  const a=points[hi-1],b=points[hi];if(b.t-a.t>.6||b.f<=a.f)return null;
  return a.t+(b.t-a.t)*(fraction-a.f)/(b.f-a.f);
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
    .map(p=>({f:(p.Distance-d0)/total,t:p.ElapsedSeconds-origin,v:p.Speed}));
  if(points.length<30||points.some((p,i)=>i&&(p.f<=points[i-1].f||p.t<=points[i-1].t)))return null;
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

export function measureRaceCornerGroup(entries,fallbackMarkers=[]) {
  const ready=entries.map(e=>({...e,native:registered(e)})).filter(e=>e.native).sort((a,b)=>a.row.driver.code.localeCompare(b.row.driver.code));
  if(ready.length<3)return [];
  const ref=ready[0],ownMarkers=(ref.payload.corners||[]).filter(c=>finite(c.fraction));
  const markers=(ownMarkers.length?ownMarkers:fallbackMarkers).filter(c=>finite(c.fraction)&&c.fraction>0&&c.fraction<1).sort((a,b)=>a.fraction-b.fraction);
  if(markers.length<3)return [];
  const measured=ready.map(e=>({...e,data:registered(e,ref.native.anchors)})).filter(e=>e.data);
  const zones=markers.map((m,i)=>{
    const left=i?(markers[i-1].fraction+m.fraction)/2:0,right=i<markers.length-1?(m.fraction+markers[i+1].fraction)/2:1;
    const start=Math.max(left,m.fraction-130/ref.native.total),end=Math.min(right,m.fraction+100/ref.native.total);
    const speeds=measured.map(e=>Math.min(...e.data.points.filter(p=>p.f>=start&&p.f<=end).map(p=>p.v))).filter(finite);
    const apex=median(speeds);return {start,end,band:finite(apex)?apex<=120?'low':apex<=200?'medium':'high':null};
  });
  if(zones.some(z=>!z.band))return [];
  // Every entrant in this observation must support the same corner windows.
  const rows=measured.map(e=>{const times=zones.map(z=>{const points=e.data.points.filter(p=>p.f>=z.start&&p.f<=z.end);
    if(points.length<3||points.some((p,i)=>i&&p.t-points[i-1].t>.6))return null;
    const a=elapsedAt(e.data.points,z.start),b=elapsedAt(e.data.points,z.end);return finite(a)&&finite(b)?b-a:null;});
    return times.every(t=>finite(t)&&t>0)?{team:e.row.driver.team,color:e.row.driver.team_color,driver:e.row.driver.code,lap:e.row.lap,times}:null;}).filter(Boolean);
  if(rows.length<3)return [];
  return rows.map(row=>{const values={};for(const band of ['all','low','medium','high']){
    const indices=zones.map((z,i)=>band==='all'||z.band===band?i:-1).filter(i=>i>=0);
    const own=mean(indices.map(i=>row.times[i]));const fastest=Math.min(...rows.map(r=>mean(indices.map(i=>r.times[i]))).filter(finite));
    values[band]=indices.length?Math.max(0,own-fastest):null;}
    return {...row,values,corners:zones.length,compound:entries[0].row.compound};});
}
