// Offline comparison of season estimators on the exact retained per-weekend inputs.
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {avg,median} from '../performance-format.js';
import {SPEED_DOMAIN_METRICS,speedDomainSeason} from '../speed-domain.js';

const base=process.argv[2] ? pathToFileURL(resolve(process.argv[2])+sep) : new URL('../assets/data/prerendered/',import.meta.url);
const index=JSON.parse(fs.readFileSync(new URL('index.json',base))).entries;
const cohorts=new Map();
for(const [url,entry] of Object.entries(index)){
  const {pathname,searchParams:q}=new URL(url,'https://local.invalid');
  if(pathname!=='/api/performance/trace-batch'||q.get('measures')!=='speed')continue;
  const payload=JSON.parse(gunzipSync(fs.readFileSync(new URL(entry.file||entry,base))));
  const windows=JSON.parse(q.get('windows'));
  if(!windows.length||windows.every(w=>w.team===w.driver))continue;
  const year=q.get('year'),name=q.get('gp');
  if(!cohorts.has(year))cohorts.set(year,new Map());
  const byEvent=cohorts.get(year);
  if(byEvent.has(name))throw Error('Multiple inputs for '+year+' '+name+'; resolve revision first');
  const knownSlicks=windows.every(w=>/^(SOFT|MEDIUM|HARD|C[0-6])$/i.test(w.compound||''));
  byEvent.set(name,{name,knownSlicks,speedDomain:{team:payload.speed_domain}});
}
const estimators={mean:avg,median,withoutFastest:a=>avg(a.slice(1)),withoutSlowest:a=>avg(a.slice(0,-1)),
  trimmed:a=>{const k=Math.floor(a.length*.05);return avg(a.slice(k,a.length-k));}};
for(const [year,events] of cohorts){
  for(const key of Object.keys(SPEED_DOMAIN_METRICS)){
    const {rows,gps,sharedEvents}=speedDomainSeason([...events.values()],'team',key);
    const scores=rows.filter(r=>r.gps>=Math.ceil(gps/2)).map(r=>({name:r.name,
      points:r.perEvent.map(p=>p.value).sort((a,b)=>a-b)}));
    if(!scores.length)continue;
    const orders=Object.fromEntries(Object.entries(estimators).map(([method,estimate])=>{
      const field=scores.map(r=>({name:r.name,value:estimate(r.points)})).filter(r=>Number.isFinite(r.value));
      field.sort((a,b)=>a.value-b.value||a.name.localeCompare(b.name));
      return [method,field.map(r=>r.name)];
    }));
    // Predict the direction of pairwise differences at an unseen weekend.
    // Each held-out GP receives one vote even when its field is larger.
    const predictions={mean:[],median:[]};
    const leadersAfterOmission=new Set();
    for(const held of sharedEvents){
      const training=sharedEvents.filter(gp=>gp!==held);
      if(training.length<3)continue;
      const field=rows.filter(r=>Number.isFinite(r.value)).map(r=>{
        const values=r.perEvent.filter(p=>training.includes(p.event)).map(p=>p.value);
        return {name:r.name,actual:r.perEvent.find(p=>p.event===held).value,mean:avg(values),median:median(values)};
      });
      const low=Math.min(...field.map(r=>r.mean));
      for(const row of field)if(row.mean===low)leadersAfterOmission.add(row.name);
      for(const method of Object.keys(predictions)){
        let score=0,pairs=0;
        for(let i=0;i<field.length;i++)for(const rival of field.slice(i+1)){
          const actual=Math.sign(field[i].actual-rival.actual);
          if(!actual)continue;
          const predicted=Math.sign(field[i][method]-rival[method]);
          score+=predicted===actual?1:predicted===0?.5:0;
          pairs++;
        }
        if(pairs)predictions[method].push(score/pairs);
      }
    }
    const coverageSensitivity=Object.fromEntries([1/3,1/2,2/3,1].map(fraction=>{
      const minimum=Math.ceil(gps*fraction);
      const eligible=rows.filter(r=>r.gps>=minimum);
      const measured=eligible.map(row=>new Map(row.perEvent.map(p=>[p.event,p.value])));
      const shared=eligible.length>=2?[...measured[0].keys()].filter(gp=>measured.every(r=>r.has(gp))):[];
      const table=shared.length>=minimum?eligible.map((r,i)=>[r.name,avg(shared.map(gp=>measured[i].get(gp)))])
        .sort((a,b)=>a[1]-b[1]):[];
      return [Math.round(fraction*100)+'%',{eligible:eligible.length,shared:shared.length,
        leaders:table.filter(([,value])=>value===table[0]?.[1]).map(([team])=>team)}];
    }));
    const matched=rows.filter(r=>Number.isFinite(r.value)).sort((a,b)=>a.value-b.value).map(r=>r.name);
    const slicks=speedDomainSeason([...events.values()].filter(event=>event.knownSlicks),'team',key);
    const slickRanking=slicks.rows.filter(r=>Number.isFinite(r.value)).sort((a,b)=>a.value-b.value);
    console.log(JSON.stringify({year,key,gps,shared:sharedEvents.length,matched,
      slickOnly:{supported:slicks.gps,shared:slicks.sharedEvents.length,leader:slickRanking[0]?.name||null},
      leadersAfterOmission:[...leadersAfterOmission],
      coverageSensitivity,heldOutPairAccuracy:{mean:avg(predictions.mean),median:avg(predictions.median)},
      counts:Object.fromEntries(scores.map(r=>[r.name,r.points.length])),orders}));
  }
}
