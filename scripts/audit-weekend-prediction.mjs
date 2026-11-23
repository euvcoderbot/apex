// Held-out weekend predictive errors are evaluated within entrant and metric.
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {avg,median} from '../performance-format.js';
const base=new URL('../assets/data/prerendered/',import.meta.url);
const entries=JSON.parse(readFileSync(new URL('index.json',base))).entries;
const cohorts=new Map();
function observe(year,metric,event,name,value){
  if(!Number.isFinite(value))return;
  const key=year+' '+metric;
  if(!cohorts.has(key))cohorts.set(key,new Map());
  const teams=cohorts.get(key);
  if(!teams.has(name))teams.set(name,new Map());
  teams.get(name).set(event,value);
}
for(const [url,file] of Object.entries(entries)){
  const {pathname,searchParams:q}=new URL(url,'https://local.invalid');
  if(!['/api/performance','/api/performance/pits'].includes(pathname))continue;
  const p=JSON.parse(gunzipSync(readFileSync(new URL(file.file||file,base))));
  const add=(metric,team,value)=>observe(q.get('year'),metric,p.event,team,value);
  if(pathname.endsWith('/pits')){
    for(const team of new Set(p.visits.map(v=>v.team))){
      const visits=p.visits.filter(v=>v.team===team&&v.visit_type==='service');
      add('stationary seconds',team,median(visits.map(v=>v.stop_duration)));
      const field=median(p.visits.filter(v=>v.visit_type==='service').map(v=>v.lane_duration));
      const lane=median(visits.map(v=>v.lane_duration));
      if(Number.isFinite(lane)&&Number.isFinite(field))add('lane seconds vs field',team,lane-field);
    }
    continue;
  }
  for(const team of p.teams){
    add(q.get('session')+' reported pace %',team.team,team.pace);
    if(q.get('session')==='Q'){
      add('Q condition-adjusted pace %',team.team,team.pace_condition_adjusted);
      continue;
    }
    if(q.get('session')!=='R')continue;
    if(team.race_pace_basis==='clear-air'&&!team.provisional){
      add('R clear-air pace %',team.team,team.pace);
    }
    if(team.starts>0)add('recorded mechanical per start',team.team,team.mechanical/team.starts);
    const stints=(team.tyre_age_stints||[]).filter(s=>s.samples>=6&&Number.isFinite(s.raw_slope));
    for(const compound of new Set(stints.map(s=>s.compound))){
      const own=stints.filter(s=>s.compound===compound);
      add(compound+' observed tyre slope s/lap',team.team,median([...new Set(own.map(s=>s.driver))].map(d=>median(own.filter(s=>s.driver===d).map(s=>s.raw_slope)))));
    }
  }
}
for(const [metric,teams] of cohorts){
  const errors={mean:[],median:[]},leaders={};
  const enough=[...teams].filter(([,v])=>v.size>=4);
  for(const [key,estimate] of Object.entries({mean:avg,median})){
    const scores=enough.map(([team,points])=>[team,estimate([...points.values()])]).sort((a,b)=>a[1]-b[1]);
    leaders[key]=scores.filter(s=>s[1]===scores[0]?.[1]).map(s=>s[0]);
    for(const [,points] of enough)for(const [gp,target] of points){
      const training=[...points].filter(([event])=>event!==gp).map(([,v])=>v);
      errors[key].push(Math.abs(estimate(training)-target));
    }
  }
  if(errors.mean.length)console.log(JSON.stringify({metric,observations:errors.mean.length,leaders,heldOutMeanAbsoluteError:{mean:avg(errors.mean),median:avg(errors.median)}}));
}
