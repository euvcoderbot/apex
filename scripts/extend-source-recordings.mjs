// Verify identity by original request hashes or independent UTC-origin consensus;
// never identify a session from circuit shape or alter native telemetry clocks.
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gunzipSync,gzipSync} from 'node:zlib';
import {normalizeDataPath} from '../lib/data-cache.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex'),now=Date.now();
const packed=JSON.parse(gunzipSync(await readFile('verified-sources.json.gz'))),files=new Map(),versions=new Set();
for(const commit of execFileSync('git',['log','--all','--format=%H','--','lib/cache-revision.mjs'],{encoding:'utf8'}).trim().split('\n')){
  const source=execFileSync('git',['show',commit+':lib/cache-revision.mjs'],{encoding:'utf8'});
  for(const match of source.matchAll(/(?:SOURCE_REVISION|CACHE_REVISION) = "([a-f0-9]+)"/g))versions.add(match[1]);
}
const seed=JSON.parse(await readFile('lib/verified-cache-seed.json'));versions.add(seed.sourceRevision);
for(const dir of ['ui-cache','../outputs/ui-cache'])for(const file of await readdir(dir)){
  if(!/^[a-f0-9]{64}\.json$/.test(file))continue;
  try{const raw=await readFile(dir+'/'+file),entry=JSON.parse(raw);
    // Expired raw pit visits remain a labelled last resort after live lookup
    // fails. Expired native telemetry is never offered as a current race plan.
    if(entry.expires<=now&&!entry.data?.visits?.length)continue;
    const previous=files.get(file.slice(0,-5));if(!previous||entry.expires>previous.entry.expires)files.set(file.slice(0,-5),{entry,sha256:hash(raw)});
  }catch{}
}
let nativeAdded=0,pitsAdded=0;
for(const [identity,record]of Object.entries(packed.sessions)){
  const [year,gp,session]=identity.split(':'),round=gp==='Singapore Grand Prix'?17:16;
  if(session==='R'){
    const candidates=[...files.values()].filter(({entry:{data:d}})=>d?.event===gp&&d?.year===+year&&Array.isArray(d.visits)&&d.visits.length);
    const best=candidates.sort((a,b)=>b.entry.expires-a.entry.expires)[0];
    if(best){const capturedExpiry=Date.parse(best.entry.data.source_cache?.expires_at||'');
      record.pits={data:best.entry.data,expires:Math.min(best.entry.expires,Number.isFinite(capturedExpiry)?capturedExpiry:Infinity)/1000,source_sha256:best.sha256};pitsAdded++;}
  }
  for(const driver of record.data.drivers)for(const lap of driver.laps){
    if(!Number.isFinite(lap.time)||!Number.isFinite(lap.lap_start_seconds)||!Number.isFinite(lap.lap_end_seconds))continue;
    if(record.telemetry.some(t=>t.selection.driver===driver.code&&t.selection.lap===lap.lap))continue;
    let found;
    for(const r of [round,'',null])for(const includeKey of [true,false])for(const bounds of [true,false]){
      const p=new URLSearchParams({year,gp,...(r===null?{}:{round:r}),session,driver:driver.code,driver_number:driver.number,
        lap:lap.lap,lap_time:lap.time,lap_start_seconds:lap.lap_start_seconds,lap_end_seconds:lap.lap_end_seconds});
      if(includeKey&&record.data.openf1_session_key)p.set('session_key',record.data.openf1_session_key);
      // The alignment-recovery path deliberately reselects by exact driver/lap
      // identity when the external relative session clock is displaced.
      if(!bounds){p.delete('lap_start_seconds');p.delete('lap_end_seconds');}
      const path=normalizeDataPath('/api/telemetry?'+p);
      for(const revision of versions)for(const family of ['source','data']){
        const f=files.get(hash(family+':'+revision+':'+path));if(!f)continue;
        const d=f.entry.data;
        if(d?.driver!==driver.code||d.lap!==lap.lap||d.position_complete===false||d.samples?.length<30)continue;
        if(Math.abs(d.samples.at(-1).ElapsedSeconds-lap.time)>.005)continue;
        found=f;break;
      }
      if(found)break;
    }
    if(!found)continue;
    const d=found.entry.data;
    record.telemetry.push({selection:{driver:driver.code,driver_number:driver.number,team:driver.team,lap:lap.lap,time:lap.time,
      start:lap.lap_start_seconds,end:lap.lap_end_seconds,compound:lap.compound,phase:lap.phase,sectors:[lap.s1,lap.s2,lap.s3]},
      samples:d.samples,corners:d.corners||[],source:d.source,expires:found.entry.expires/1000,archive_sha256:found.sha256});nativeAdded++;
  }
}
// Some development cache entries predate committed revision keys. Require a
// multi-driver UTC-origin consensus, exact driver/lap/duration and session date
// before retaining one of these recordings. Never identify a lap from GPS shape.
for(const [identity,record]of Object.entries(packed.sessions)){
  if(!identity.endsWith(':R'))continue;
  const scheduled=Date.parse(record.data.date.replace(' ','T')+'Z')/1000,candidates=[];
  for(const f of files.values()){
    const d=f.entry.data;if(!d?.samples?.length||d.position_complete===false)continue;
    const driver=record.data.drivers.find(r=>r.code===d.driver),lap=driver?.laps.find(l=>l.lap===d.lap);
    if(!lap||!Number.isFinite(lap.time)||!Number.isFinite(lap.lap_start_seconds))continue;
    const first=d.samples[0],last=d.samples.at(-1);
    if(Math.abs(last.ElapsedSeconds-lap.time)>.005||!Number.isFinite(first.Timestamp))continue;
    if(new Date(first.Timestamp*1000).toISOString().slice(0,10)!==record.data.date.slice(0,10))continue;
    const origin=first.Timestamp-first.ElapsedSeconds-lap.lap_start_seconds;
    if(origin<scheduled-6*3600||origin>scheduled+3600)continue;
    candidates.push({f,d,driver,lap,origin});
  }
  const clusters=[];
  for(const row of candidates.sort((a,b)=>a.origin-b.origin)){
    let cluster=clusters.at(-1);if(!cluster||row.origin-cluster[0].origin>.005)clusters.push(cluster=[]);cluster.push(row);
  }
  clusters.sort((a,b)=>new Set(b.map(r=>r.driver.code)).size-new Set(a.map(r=>r.driver.code)).size);
  const best=clusters[0]||[],size=new Set(best.map(r=>r.driver.code)).size,second=new Set((clusters[1]||[]).map(r=>r.driver.code)).size;
  if(size<3||second>1&&size<second*2)continue;
  for(const {f,d,driver,lap}of best){
    if(record.telemetry.some(t=>t.selection.driver===driver.code&&t.selection.lap===lap.lap))continue;
    record.telemetry.push({selection:{driver:driver.code,driver_number:driver.number,team:driver.team,lap:lap.lap,time:lap.time,
      start:lap.lap_start_seconds,end:lap.lap_end_seconds,compound:lap.compound,phase:lap.phase,sectors:[lap.s1,lap.s2,lap.s3]},
      samples:d.samples,corners:d.corners||[],source:d.source,expires:f.entry.expires/1000,archive_sha256:f.sha256,
      identity_validation:{method:'exact-lap-and-UTC-origin-consensus',independent_drivers:size,tolerance_seconds:.005}});nativeAdded++;
  }
}
const bytes=gzipSync(JSON.stringify(packed));await writeFile('verified-sources.json.gz',bytes);
console.log(JSON.stringify({nativeAdded,pitsAdded,bytes:bytes.length,sessions:Object.fromEntries(Object.entries(packed.sessions).map(([k,r])=>[k,{native:r.telemetry.length,pits:r.pits?.data.visits.length||0}]))}));
