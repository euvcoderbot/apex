import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createDataCache} from '../lib/data-cache.mjs';
import {loadRaceCornerPlan,loadRaceSnapshot} from '../lib/race-corner-loader.mjs';
import {connectedRaceCornerScores,ageAdjustedRaceCornerScores} from '../race-cornering.js';
const records=JSON.parse(gunzipSync(readFileSync('verified-sources.json.gz'))).sessions;

for(const [gp,round] of [['Singapore Grand Prix',17],['Bahrain Grand Prix',16]])
for(const subject of ['team','driver'])for(const model of ['matched','age-adjusted'])
test(`${gp}: retained ${subject}/${model} race observations calculate without unavailable archive requests`,async()=>{
  const store=new Map(),queried=[];
  const cache=createDataCache({read:async k=>store.get(k),write:async(k,v)=>store.set(k,v),fetcher:async url=>{
    const u=new URL(url),q=u.searchParams,r=records[`2026:${gp}:${q.get('session')}`];
    let data;
    if(u.pathname==='/api/session')data={...r.data,source_cache:{kind:'verified-recording'},available_telemetry:r.telemetry.map(t=>({driver:t.selection.driver,lap:t.selection.lap}))};
    else if(u.pathname==='/api/performance')data={teams:[...new Set(r.data.drivers.map(d=>d.team))].map(team=>({team,fastest_race_driver:r.data.drivers.filter(d=>d.team===team).sort((a,b)=>Math.min(...a.laps.map(l=>l.time||Infinity))-Math.min(...b.laps.map(l=>l.time||Infinity)))[0].code}))};
    else {
      queried.push(q.get('driver')+':'+q.get('lap'));
      const item=r.telemetry.find(t=>t.selection.driver===q.get('driver')&&t.selection.lap===+q.get('lap'));
      assert.ok(item,`Unexpected unavailable archive request: ${queried.at(-1)}`);
      data={samples:item.samples,corners:item.corners||[],source:'Recorded native lap',source_cache:{kind:'verified-recording'}};
    }
    return {ok:true,json:async()=>data};
  }});
  const query={year:2026,gp,round,subject,model},plan=await loadRaceCornerPlan(cache,query);
  assert.ok(plan.data.groups.length>0,'retained eligible cohorts must be planned');
  assert.equal(plan.data.source_coverage.kind,'recorded-native-only');
  const observations=[],failed=[];
  for(const g of plan.data.groups){const result=await loadRaceSnapshot(cache,{...query,lap:g.lap,compound:g.compound,cohort:g.cohort});
    if(!result.data.complete)failed.push({lap:g.lap,errors:result.data.requestErrors,reason:result.data.reason});
    observations.push(...result.data.observations);}
  const fit=model==='matched'?connectedRaceCornerScores(observations,'all',subject):ageAdjustedRaceCornerScores(observations,'all',subject);
  if(gp==='Bahrain Grand Prix'&&subject==='driver'&&model==='age-adjusted'){
    assert.equal(fit.scores.size,0);assert.match(fit.reason,/not independently identifiable/);
  }else assert.ok(fit.scores.size>=3,fit.reason||'at least one supported connected cohort');
  if(gp==='Singapore Grand Prix'&&subject==='team'&&model==='matched')assert.equal(fit.scores.size,11,'all eleven teams form the retained matched cohort');
  console.log(JSON.stringify({gp,subject,model,groups:plan.data.groups.length,rejectedGroups:failed.length,measured:new Set(observations.map(o=>subject==='team'?o.team:o.driver)).size,ranked:fit.scores.size,reason:fit.reason,native:new Set(queried).size}));
});
