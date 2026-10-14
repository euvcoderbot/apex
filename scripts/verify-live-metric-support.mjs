import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {fastestTeamTelemetrySelections} from '../qualifying-telemetry.js';
const source=readFileSync('car-performance.js','utf8'),body=source.slice(source.indexOf('function eventTelemetry(event)'),source.indexOf('function seasonTelemetry('));
for(const subject of ['team','driver']){
  const captured=JSON.parse(readFileSync('../outputs/2026-Singapore-Grand-Prix-metric-replay'+(subject==='driver'?'-driver':'')+'.json'));
  const Q=subject==='team'?captured.Q:{teams:captured.entries.map(e=>({team:e.selection.team,lap:e.selection}))};
  const windows=subject==='team'?fastestTeamTelemetrySelections(Q.teams):captured.entries.map(e=>e.selection);
  const url='https://apex-telemetry-api.vercel.app/api/performance/trace-batch?'+new URLSearchParams({year:2026,gp:'Singapore Grand Prix',windows:JSON.stringify(windows)});
  const r=await fetch(url);if(!r.ok)throw new Error('Live API '+r.status+': '+await r.text());
  const batch=await r.json(),core=Object.values(batch.teams||{}).filter(t=>Number.isFinite(t.straight_core_time));
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
  console.log(JSON.stringify({subject,measured:Object.keys(batch.teams).length,coreRanked:core.length,coreDistance:core[0]?.straight_core_distance_m,
    intervals:observed.length,supported:observed.filter(z=>z.quality==='supported').length,versions:[...new Set(observed.map(z=>z.braking_version))],ranks,excluded:batch.excluded},null,2));
}
