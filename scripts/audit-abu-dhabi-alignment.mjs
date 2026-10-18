// Read-only replay of the exact requested laps through production alignment.
import {readFile,writeFile} from 'node:fs/promises';
import vm from 'node:vm';
const origin=process.env.APEX_AUDIT_ORIGIN||'http://127.0.0.1:8000';
async function get(path){const r=await fetch(origin+path,{signal:AbortSignal.timeout(180000)});const d=await r.json();if(!r.ok)throw Error(JSON.stringify(d));return d;}
const base={year:2025,gp:'Abu Dhabi Grand Prix',round:24,session:'Q'};
const session=await get('/api/session?'+new URLSearchParams(base));
const loaded=[],telemetryCache=new Map(),sources=[];
for(const code of ['VER','NOR']){
  const driver=session.drivers.find(d=>d.code===code);
  const real=driver.laps.filter(l=>Number.isFinite(l.time)&&l.time>0&&!l.in_lap&&!l.out_lap).sort((a,b)=>a.time-b.time)[0];
  const lap={code,lap:real.lap,time:real.time,real};loaded.push(lap);
  const q=new URLSearchParams({...base,driver:code,driver_number:driver.number,lap:lap.lap,lap_time:lap.time});
  for(const field of ['lap_start_seconds','lap_end_seconds'])if(Number.isFinite(real[field]))q.set(field,real[field]);
  const payload=await get('/api/telemetry?'+q);sources.push(payload);
}
const box={loaded,telemetryCache,telemetryKey:l=>`${l.code}:${l.lap}`,$:()=>null,document:{getElementById:()=>null}};
vm.createContext(box);vm.runInContext(await readFile('alignment.js','utf8'),box);
loaded.forEach((lap,i)=>telemetryCache.set(box.telemetryKey(lap),box.normalizeTelemetry(sources[i].samples,lap,sources[i].source)));
box.prepareTelemetryAlignment();
const laps=loaded.map(l=>{
  const s=telemetryCache.get(box.telemetryKey(l));
  const official=[0,l.real.s1,l.real.s1+l.real.s2,l.time];
  const fractions=[0,...s.alignmentSectors,1];
  return {driver:l.code,lap:l.lap,time:l.time,sectors:[l.real.s1,l.real.s2,l.real.s3],source:s.source,samples:s.length,
    method:s.alignmentMethod,timeOrigin:s.timeOrigin,positionCoverage:s.quality.positionCoverage,
    monotone:s.every((p,i)=>!i||p.AlignedFraction>=s[i-1].AlignedFraction),
    anchorErrors:fractions.map((f,i)=>box.calibratedElapsed(s,f)-official[i])};
});
const a=telemetryCache.get(box.telemetryKey(loaded[0])),b=telemetryCache.get(box.telemetryKey(loaded[1]));
let arc=0;for(let i=1;i<a.length;i++)if(a[i].X!=null&&a[i-1].X!=null)arc+=Math.hypot(a[i].X-a[i-1].X,a[i].Y-a[i-1].Y);
const unitsPerMetre=arc/a.at(-1).Distance,distances=[];
for(let i=10;i<=990;i++){const f=i/1000;distances.push(Math.hypot(box.alignedValue(a,f,'X')-box.alignedValue(b,f,'X'),box.alignedValue(a,f,'Y')-box.alignedValue(b,f,'Y'))/unitsPerMetre);}
distances.sort((a,b)=>a-b);
const result={event:'2025 Abu Dhabi qualifying',laps,finishDelta:box.calibratedElapsed(b,1)-box.calibratedElapsed(a,1),
  positionSeparationMetres:{median:distances[Math.floor(distances.length/2)],p95:distances[Math.floor(distances.length*.95)],max:distances.at(-1)},
  note:'Separation includes real racing-line differences and source sampling. It is not a measurement confidence interval.'};
console.log(JSON.stringify(result,null,2));
if(laps.some(l=>!l.monotone||l.anchorErrors.some(e=>Math.abs(e)>.000001)))throw Error('Alignment/timing anchors failed');
await writeFile(process.argv[2]||'../outputs/abu-dhabi-2025-alignment-v133.json',JSON.stringify(result,null,2));
