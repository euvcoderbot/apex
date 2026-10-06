// Circuit positions, never inferred from throttle lift or speed minima alone.
const finite=n=>typeof n==='number'&&Number.isFinite(n);
// Keep native corner measurements separate from batch straight/braking results.
export function withCornerMeasurements(traces,measurements={}) {
  const result={...traces};
  for(const [key,values] of Object.entries(measurements))result[key]={...result[key],...values};
  return result;
}
const SEPANG=[[0,.477778],[.094181,.517310],[.070923,.785614],[.479518,.992982],
  [.604422,.655322],[.774407,.745614],[1,.466316],[.957504,.364211],
  [.547569,.291813],[.638783,.175322],[.572071,0],[.338821,.200585],
  [.162902,.151111],[.095616,.249942],[.858059,.488187]];
// FIA Madring v3 map estimates; same documented fallback as Session Analysis.
const MADRID=[['1',454],['2',505],['3',643],['4',1332],['5',1545],['5A',1569],['6',1605],
  ['7',1924],['8',1983],['9',2086],['10',2271],['11',2370],['12',2696],['13',3301],
  ['14',3492],['15',3732],['16',3928],['17',3993],['18',4237],['19',4455],['20',4789],
  ['20A',4833],['21',4943],['22',5260]];
export function circuitCornerMarkers(payload,session={}) {
  const samples=payload.samples||[],gps=samples.filter(p=>finite(p.X)&&finite(p.Y)&&finite(p.Distance));
  if(gps.length<30)return [];
  const origin=samples[0].Distance,total=samples.at(-1).Distance-origin;
  if(!(total>1000))return [];
  const lo=[Math.min(...gps.map(p=>p.X)),Math.min(...gps.map(p=>p.Y))];
  const span=[Math.max(...gps.map(p=>p.X))-lo[0],Math.max(...gps.map(p=>p.Y))-lo[1]];
  if(span.some(v=>v<=0))return [];
  const sepang=Number(session.circuit_key)===12 || !session.circuit_key&&/sepang|kuala lumpur/i.test(session.location||'');
  let supplied=payload.corners?.length?payload.corners:session.corners||[];
  if(Number(session.year)>=2026&&/spanish grand prix/i.test(session.event||'')&&new Set(supplied.map(c=>Number(c.number))).size<22)
    supplied=MADRID.map(([label,d])=>({number:label.replace(/[A-Z]/g,''),letter:label.replace(/[0-9]/g,''),fraction:d/5414,approximate:true,source:'fia_map_estimate'}));
  const rows=sepang&&!supplied.length?SEPANG.map(([x,y],i)=>({number:String(i+1),x,y,normalized:true,approximate:true})):supplied;
  let previous=-Infinity;
  return [...rows].sort((a,b)=>Number(a.number)-Number(b.number)||String(a.letter||'').localeCompare(String(b.letter||''))).flatMap(c=>{
    let fraction=c.fraction,error=0;
    if(!finite(fraction)) {
      const x=c.normalized?c.x:finite(c.x)?(c.x-lo[0])/span[0]:null;
      const y=c.normalized?c.y:finite(c.y)?(c.y-lo[1])/span[1]:null;
      if(!finite(x)||!finite(y))return [];
      let best=null;
      for(let i=1;i<gps.length;i++) {
        const a=gps[i-1],b=gps[i],fa=(a.Distance-origin)/total,fb=(b.Distance-origin)/total;
        if(fb<=previous||fb-fa>.025)continue;
        const ax=(a.X-lo[0])/span[0],ay=(a.Y-lo[1])/span[1],dx=(b.X-a.X)/span[0],dy=(b.Y-a.Y)/span[1];
        const t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy||1))),f=fa+(fb-fa)*t;
        if(f<=previous)continue;
        const e=Math.hypot(ax+t*dx-x,ay+t*dy-y);
        if(!best||e<best.error)best={fraction:f,error:e};
      }
      if(!best||best.error>.045)return [];
      ({fraction,error}=best);
    }
    if(fraction<=previous||fraction<=0||fraction>=1)return [];
    previous=fraction;
    return [{...c,fraction,error,label:String(c.number||'')+String(c.letter||'')}];
  });
}

export function qualifyingRepresentatives(session,subject='driver',officialTeams=[]) {
  const rows=(session.drivers||[]).flatMap(driver=>{
    const eligible=(driver.laps||[]).filter(l=>finite(l.time)&&l.time>20&&!l.in_lap&&!l.out_lap&&!l.deleted
      &&l.accurate!==false&&['Q1','Q2','Q3'].includes(l.phase)&&['SOFT','MEDIUM','HARD','SUPERSOFT','ULTRASOFT','HYPERSOFT'].includes(l.compound)
      &&!l.conditions?.rainfall&&finite(l.lap_start_seconds)&&finite(l.lap_end_seconds));
    const official=officialTeams.find(t=>t.lap?.driver===driver.code)?.lap;
    // Preserve the authoritative team-best identity when it exists.
    const lap=official?eligible.find(l=>l.lap===official.lap&&Math.abs(l.time-official.time)<.0005):eligible.sort((a,b)=>a.time-b.time)[0];
    return lap?[{...lap,driver,time:lap.time}]:[];
  });
  if(subject==='driver')return rows;
  const teams=new Map();
  for(const row of rows){const old=teams.get(row.driver.team);if(!old||row.time<old.time)teams.set(row.driver.team,row);}
  return [...teams.values()];
}
