import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {fastestTeamTelemetrySelections} from '../qualifying-telemetry.js';
const source=readFileSync('car-performance.js','utf8'),body=source.slice(source.indexOf('function eventTelemetry(event)'),source.indexOf('function seasonTelemetry('));
for(const subject of ['team','driver']){
  const captured=JSON.parse(readFileSync('../outputs/2026-Singapore-Grand-Prix-metric-replay'+(subject==='driver'?'-driver':'')+'.json'));
  const Q=subject==='team'?captured.Q:{teams:captured.entries.map(e=>({team:e.selection.team,lap:e.selection}))};
  const windows=subject==='team'?fastestTeamTelemetrySelections(Q.teams):captured.entries.map(e=>e.selection);
  const url='https://apex-telemetry-api.vercel.app/api/performance/trace-batch?'+new URLSearchParams({year:2026,gp:'Singapore Grand Prix',windows:JSON.stringify(windows)});
  const offline=process.argv.includes('--offline');
  let batch;
  if(offline)batch=JSON.parse(readFileSync('../outputs/2026-Singapore-Grand-Prix-metric-replay'+(subject==='driver'?'-driver':'')+'-result.json'));
  else {const r=await fetch(url);if(!r.ok)throw new Error('Live API '+r.status+': '+await r.text());batch=await r.json();}
  const core=Object.values(batch.teams||{}).filter(t=>Number.isFinite(t.straight_core_time));
  const observed=Object.values(batch.teams||{}).flatMap(t=>t.braking||[]);
  const ranks={};
  for(const mode of ['connected','independent']){
    const box={finite:Number.isFinite,avg:a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null,
      median:a=>{const b=[...a].sort((x,y)=>x-y);return b.length?b.length%2?b[b.length>>1]:(b[b.length/2-1]+b[b.length/2])/2:null;},
      brakingQualityMode:'supported',brakingComparisonMode:mode,telemetryCoverageMode:'common'};
    vm.createContext(box);vm.runInContext(body,box);
    const result=box.eventTelemetry({name:'Singapore Grand Prix',Q,traces:batch.teams});
    ranks[mode]={ranked:result.brakingCoverage.teams,zoneCount:result.brakingCoverage.events.length};
  }
  if(core.length<3||ranks.connected.ranked.length<3)throw new Error('Live '+subject+' still has no usable comparison');
  const bands=Object.fromEntries(['100_150','150_200','200_250','250_300','300_320'].map(b=>[b,{
    connected:Object.values(batch.teams||{}).filter(t=>Number.isFinite(t.accel_bands?.[b]?.gap_s)).length,
    common:Object.values(batch.teams||{}).filter(t=>Number.isFinite(t.accel_common_bands?.[b]?.gap_s)).length}]));
  for(const t of Object.values(batch.teams||{}))for(const z of t.braking||[]) {
    if(z.speed_low_m>z.zone_end_m+1e-6||z.speed_high_m<z.zone_start_m-1e-6)throw new Error('Crossing escaped straight braking window');
  }
  if(bands['200_250'].connected!==Object.keys(batch.teams).length)throw new Error('Valid Singapore acceleration entrants lost');
  console.log(JSON.stringify({offline,subject,bands,measured:Object.keys(batch.teams).length,coreRanked:core.length,coreDistance:core[0]?.straight_core_distance_m,
    intervals:observed.length,supported:observed.filter(z=>z.quality==='supported').length,versions:[...new Set(observed.map(z=>z.braking_version))],ranks,excluded:batch.excluded},null,2));
}
