// Exercise public loading contracts, including cold calculation dependencies.
import {readFile,writeFile} from 'node:fs/promises';
const origin=process.env.APEX_AUDIT_ORIGIN||'https://f1apexdata.eufrandota14.chatgpt.site';
const results=[],jobs=[],snapshots=process.env.APEX_AUDIT_SNAPSHOTS==='1';
for(const [year,gp,round]of [[2026,'Singapore Grand Prix',17],[2026,'Bahrain Grand Prix',16],[2025,'Japanese Grand Prix',3]]){
  for(const session of ['Q','R'])jobs.push({kind:'summary '+session,year,gp,path:'/api/performance?'+new URLSearchParams({year,gp,session})});
  jobs.push({kind:'pits',year,gp,path:'/api/performance/pits?'+new URLSearchParams({year,gp})});
  if(year===2026)for(const subject of ['team','driver'])for(const model of ['matched','age-adjusted'])
    jobs.push({kind:'race corners '+subject+' '+model,year,gp,measured:true,path:'/api/race-corners?'+new URLSearchParams({year,gp,round,subject,model,cached:1})});
}
for(const [name,gp]of [['2026-Singapore-Grand-Prix-metric-replay-archive.json','Singapore Grand Prix'],['2026-Singapore-Grand-Prix-metric-replay-driver-archive.json','Singapore Grand Prix'],['2026-Bahrain-Grand-Prix-metric-replay-archive.json','Bahrain Grand Prix']]){
  const data=JSON.parse(await readFile('../outputs/'+name,'utf8'));
  jobs.push({kind:'straight/braking '+(name.includes('driver')?'drivers':'teams'),year:2026,gp,path:'/api/performance/trace-batch?'+new URLSearchParams({year:2026,gp,windows:JSON.stringify(data.selections)})});
}
async function worker(){while(jobs.length){const j=jobs.shift(),started=performance.now();let row;
  try{const response=await fetch(origin+(j.measured?j.path:'/api/data'),j.measured?{signal:AbortSignal.timeout(65000)}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:j.path}),signal:AbortSignal.timeout(65000)});
    const d=await response.json();
    if(snapshots&&d.groups?.length){const q=new URL(j.path,origin).searchParams;
      for(const g of d.groups.slice(0,j.gp==='Singapore Grand Prix'?4:2)){
        const p=new URLSearchParams(q);p.delete('cached');p.set('lap',g.lap);p.set('compound',g.compound);p.set('cohort',g.cohort);
        jobs.push({kind:j.kind+' snapshot L'+g.lap,year:j.year,gp:j.gp,measured:true,path:'/api/race-corners?'+p});
      }
    }
    row={kind:j.kind,year:j.year,gp:j.gp,status:response.status,seconds:(performance.now()-started)/1000,cache:response.headers.get('X-Data-Cache'),
      method:d.method,teams:Array.isArray(d.teams)?d.teams.length:Object.keys(d.teams||{}).length,visits:d.visits?.length,stationary:d.visits?.filter(v=>Number.isFinite(v.stop_duration)).length,
      raceEstimates:d.teams?.filter?.(t=>Number.isFinite(t.pace)).length,tyreStints:d.teams?.reduce?.((s,t)=>s+(t.tyre_age_stints?.length||0),0),
      groups:d.groups?.length,cachedSnapshots:d.snapshots?.length,cachedEntrants:[...new Set((d.snapshots||[]).flatMap(s=>s.snapshot.observations||[]).map(o=>o.team))].length,
      complete:d.complete,observations:d.observations?.length,requestErrors:d.requestErrors,
      firstGroup:d.groups?.[0]?{lap:d.groups[0].lap,compound:d.groups[0].compound,cohort:d.groups[0].cohort}:undefined,detail:d.detail,source:d.source_cache?.kind};
  }catch(e){row={kind:j.kind,year:j.year,gp:j.gp,error:e.message,seconds:(performance.now()-started)/1000};}
  results.push(row);console.log(JSON.stringify(row));
}}
await Promise.all([worker(),worker()]);
await writeFile(process.argv[2]||'../outputs/car-loading-audit.json',JSON.stringify({origin,at:new Date().toISOString(),results},null,2));
