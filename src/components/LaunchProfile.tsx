import {useState} from 'react';

type Entrant = {driver:string; grid:number; marks:Record<string,{seconds:number;kmh:number}>};
export function LaunchProfile({starts}:{starts:Entrant[]}) {
  const options=[...starts].sort((a,b)=>a.grid-b.grid);
  const [pick,setPick]=useState('');
  const run=options.find(r=>r.driver===pick)||options[0];
  if(!run)return null;
  const points=Object.entries(run.marks).map(([m,v])=>({m:Number(m),...v})).sort((a,b)=>a.m-b.m);
  const maxDistance=Math.max(...starts.flatMap(r=>Object.keys(r.marks).map(Number)));
  const top=Math.max(20,20*Math.ceil(Math.max(...starts.flatMap(r=>Object.values(r.marks).map(v=>v.kmh)))/20));
  const x=(m:number)=>(12+m/maxDistance*80)+'%', y=(v:number)=>154-126*v/top;
  return <section className="performance-chart-card start-profile">
    <div className="start-section-heading">
      <h3 className="perf-chart-heading">Speed from the grid slot</h3>
      <select aria-label="Driver" value={run.driver} onChange={e=>setPick(e.target.value)}>{options.map(r=><option key={r.driver} value={r.driver}>{r.driver} · P{r.grid}</option>)}</select>
    </div>
    <svg height="181" width="100%" fill="var(--ui-tertiary)" fontSize="11" role="group" aria-label={'Launch speed by distance for '+run.driver}>
      {[0,top/2,top].map(v=><g key={v}><line x1="12%" x2="92%" y1={y(v)} y2={y(v)} stroke="var(--ui-separator)"/><text x="10%" y={y(v)+4} textAnchor="end" className="trend-axis">{v}</text></g>)}
      <text x="8" y="13" className="trend-axis">km/h</text>
      {[0,maxDistance/2,maxDistance].map(m=><text key={m} x={x(m)} y="174" textAnchor="middle" className="trend-axis">{m} m</text>)}
      {points.map((p,i)=><line key={p.m} x1={x(i?points[i-1].m:0)} y1={y(i?points[i-1].kmh:0)} x2={x(p.m)} y2={y(p.kmh)} stroke="var(--ui-accent)" strokeWidth="2"/>)}
      {points.map((p,i)=><circle key={p.m} cx={x(p.m)} cy={y(p.kmh)} r="4" fill="var(--ui-accent)" tabIndex={i===0?0:-1} role="img" data-chart-value={'launch:'+run.driver+':'+p.m} aria-label={run.driver+' · '+p.m+' m · '+Math.round(p.kmh)+' km/h · '+p.seconds.toFixed(1)+' s'}><title>{p.m} m · {Math.round(p.kmh)} km/h · {p.seconds.toFixed(1)} s</title></circle>)}
    </svg>
  </section>;
}
