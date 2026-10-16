// Download only selected native laps; persist compact derived groups for reuse.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {createDataCache,RACE_VERSION,SOURCE_VERSION,DATA_VERSION} from '../lib/data-cache.mjs';
import {SOURCE_REVISION,BACKEND_REVISION,RACE_REVISION} from '../lib/cache-revision.mjs';
import {loadRaceCornerPlan,loadRaceSnapshot} from '../lib/race-corner-loader.mjs';
import {connectedRaceCornerScores} from '../race-cornering.js';
const directory=resolve('../outputs/ui-cache');await mkdir(directory,{recursive:true});
const file=k=>resolve(directory,createHash('sha256').update(k).digest('hex')+'.json');
const captured=new Map();let requests=0;
const cache=createDataCache({read:async k=>{const v=JSON.parse(await readFile(file(k),'utf8'));captured.set(k,v);return v;},
 write:async(k,v)=>{captured.set(k,v);await writeFile(file(k),JSON.stringify(v));},fetcher:async(...args)=>{requests++;return fetch(...args);}});
const gp=process.argv[2]||'Singapore Grand Prix',year=2026,round=gp==='Singapore Grand Prix'?17:16,start=Date.now();
for(const subject of ['team','driver']){
 const options={year,gp,round,subject},plan=(await loadRaceCornerPlan(cache,options)).data;
 const jobs=[...plan.groups],observations=[],errors=[];let done=0,hits=0;
 console.log(JSON.stringify({subject,groups:jobs.length,plan:plan.plan,source:plan.source_coverage}));
 async function worker(){while(jobs.length){const group=jobs.shift();
  try{const result=await loadRaceSnapshot(cache,{...options,lap:group.lap,compound:group.compound,cohort:group.cohort});
   observations.push(...result.data.observations||[]);if(result.cache==='HIT')hits++;
   if(!result.data.complete)errors.push({lap:group.lap,reasons:result.data.requestErrors,reason:result.data.reason});
   if(result.data.sourcePaused){jobs.length=0;console.log(JSON.stringify({sourcePaused:true,subject,lap:group.lap}));}
  }catch(e){errors.push({lap:group.lap,error:e.message});}
  done++;if(done%10===0||done===plan.groups.length)console.log(JSON.stringify({subject,done,total:plan.groups.length,requests,seconds:Math.round((Date.now()-start)/1000)}));
 }}
 await Promise.all([worker(),worker()]);
 const fit=connectedRaceCornerScores(observations,'all',subject),unique=new Map();
 for(const o of observations){const name=subject==='driver'?o.driver:o.team;if(!unique.has(name))unique.set(name,new Set());unique.get(name).add(o.driver+':'+o.lap);}
 console.log(JSON.stringify({subject,ranked:fit.scores.size,cacheHits:hits,errorCount:errors.length,errors:errors.slice(0,3),lapCounts:Object.fromEntries([...unique].map(([name,set])=>[name,set.size]))}));
}
if(process.argv.includes('--seed')){
 const entries={};
 for(const [key,value] of captured){
  if(value.expires<=Date.now())continue;
  for(const [prefix,family] of [[RACE_VERSION,'race'],[SOURCE_VERSION,'source'],[DATA_VERSION,'data']]){
   if(!key.startsWith(prefix+':'))continue;const identity=key.slice(prefix.length+1);
   if(family==='source'&&!identity.startsWith('/api/session?'))continue;
   if(family==='data'&&!identity.startsWith('/api/performance?'))continue;
   if(family==='race'&&identity.includes('lap=')&&!value.data.complete)continue;
   const {data,expires}=value;entries[family+':'+identity]={data,expires};
  }
 }
 await writeFile('lib/verified-cache-seed.json',JSON.stringify({sourceRevision:SOURCE_REVISION,backendRevision:BACKEND_REVISION,raceRevision:RACE_REVISION,entries}));
 console.log(JSON.stringify({seedEntries:Object.keys(entries).length,seconds:Math.round((Date.now()-start)/1000),requests}));
}
