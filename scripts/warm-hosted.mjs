// Fill the hosted site's result cache (Cloudflare R2) for a season after a
// deploy, so the first visitor does not pay the cold Vercel computation.
// usage: node scripts/warm-hosted.mjs [--year 2026] [--origin https://...]
// Requests exactly what the page requests, two at a time (OpenF1 rate limits).
import {fastestTeamTelemetrySelections} from '../qualifying-telemetry.js';

const args=process.argv.slice(2),arg=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const year=Number(arg('--year','2026'));
const origin=arg('--origin','https://f1apexdata.eufrandota14.chatgpt.site').replace(/\/$/,'');
const started=Date.now();

async function data(path){
  const body=JSON.stringify({path});
  for(let attempt=0;attempt<3;attempt++){
    const response=await fetch(origin+'/api/data',{method:'POST',headers:{'Content-Type':'application/json'},body,signal:AbortSignal.timeout(300000)}).catch(error=>({ok:false,status:0,statusText:error.message}));
    if(response.ok)return {cache:response.headers.get('x-data-cache'),data:await response.json()};
    if(response.status&&response.status<500)throw new Error(`${response.status} ${path.split('?')[0]}`);
    await new Promise(r=>setTimeout(r,5000*(attempt+1)));
  }
  throw new Error(`failed ${path.split('?')[0]}`);
}
async function pool(jobs,size,run){
  const queue=[...jobs];const results=[];
  await Promise.all(Array.from({length:size},async()=>{while(queue.length){const job=queue.shift();results.push(await run(job).catch(error=>({error:error.message,job})));}}));
  return results;
}
function driverWindows(teams){
  const best=new Map();
  for(const team of teams||[])for(const p of team.phase_details||[]){
    if(p.time==null||p.start==null||p.end==null||p.lap==null||p.number==null)return null;
    if(!best.has(p.driver)||p.time<best.get(p.driver).time)best.set(p.driver,p);
  }
  return [...best.values()].map(p=>({driver:p.driver,number:p.number,lap:p.lap,time:p.time,start:p.start,end:p.end,sectors:p.sectors,phase:p.phase,
    compound:p.compound,team:p.driver,team_name:p.driver,driver_number:p.number,qualifying_best_time:p.time,qualifying_best_driver:p.driver,qualifying_best_lap:p.lap}));
}

const calendar=(await data('/api/events?'+new URLSearchParams({year}))).data;
const events=(Array.isArray(calendar)?calendar:calendar.events||[]).filter(e=>e.date&&new Date(e.date+'T23:59:59Z').getTime()<Date.now());
console.log(JSON.stringify({origin,year,events:events.length}));
const sessions=await pool(events.flatMap(e=>['Q','R'].map(s=>({e,s}))),2,async({e,s})=>{
  const r=await data('/api/performance?'+new URLSearchParams({year,gp:e.name,session:s}));
  console.log(JSON.stringify({gp:e.name,session:s,cache:r.cache}));return {e,s,data:r.data};
});
const qualifying=sessions.filter(r=>r.s==='Q'&&r.data?.teams);
await pool(qualifying.flatMap(q=>[['team',fastestTeamTelemetrySelections(q.data.teams)],['driver',driverWindows(q.data.teams)]].filter(([,w])=>w&&w.length>=3).map(([subject,windows])=>({q,subject,windows}))),2,
  async({q,subject,windows})=>{
    const r=await data('/api/performance/trace-batch?'+new URLSearchParams({year,gp:q.e.name,windows:JSON.stringify(windows),measures:'speed'}));
    console.log(JSON.stringify({gp:q.e.name,telemetry:subject,cache:r.cache,cars:Object.keys(r.data?.speed_domain?.cars||{}).length}));
  });
console.log(JSON.stringify({done:true,seconds:Math.round((Date.now()-started)/1000)}));
