// Read-only structural and provenance audit. This does not assert that the
// estimated measurements are ground truth, and never rewrites a manifest.
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';

const root=process.cwd(),errors=[],summary={sessions:0,performance:0,batches:0,pits:0,sprints:0,packs:0,laps:0};
const readJson=async file=>JSON.parse(await readFile(file,'utf8'));
const readGzip=async file=>JSON.parse(gunzipSync(await readFile(file)));
const base=path.join(root,'assets/data/prerendered'),manifest=await readJson(path.join(base,'index.json'));
for(const [key,file] of Object.entries(manifest.entries||{})){
  try{
    if(!/^[a-f0-9]{24}\.json\.gz$/.test(file))throw Error('unsafe filename');
    const url=new URL(key,'https://invalid.test'),data=await readGzip(path.join(base,file));
    if(url.pathname==='/api/session'){
      if(!Array.isArray(data.drivers)||!data.drivers.length)throw Error('no drivers');
      if(data.event&&data.event!==url.searchParams.get('gp'))throw Error('event identity mismatch');
      summary.sessions++;
    }else if(url.pathname==='/api/performance'){
      if(data.method!=='car-performance-v13-supported-recovery'||!Array.isArray(data.teams)||!data.teams.length)throw Error('unsupported performance summary');
      summary.performance++;
    }else if(url.pathname==='/api/performance/trace-batch'){
      if(data.methodology_version!=='car-measurements-v18-trace-integral'||Object.keys(data.speed_domain?.cars||{}).length<3)throw Error('unsupported metric batch');
      if(!Array.isArray(JSON.parse(url.searchParams.get('windows')||'null')))throw Error('invalid window identity');
      summary.batches++;
    }else if(url.pathname==='/api/performance/pits'){
      if(!Array.isArray(data.visits))throw Error('missing visit list');summary.pits++;
    }else if(url.pathname==='/api/performance/sprint'){
      if(!Array.isArray(data.drivers))throw Error('missing classification');summary.sprints++;
    }else throw Error('unsupported snapshot family');
  }catch(error){errors.push({key:key.slice(0,130),error:error.message});}
}
const packDir=path.join(root,'assets/data/telemetry'),packs=await readJson(path.join(packDir,'index.json'));
for(const [identity,file] of Object.entries(packs.entries||{})){
  try{
    if(!/^[a-f0-9]{24}\.json\.gz$/.test(file))throw Error('unsafe filename');
    const [, , ,driver]=identity.split(':');const pack=await readGzip(path.join(packDir,file));
    if(!pack.sessionKey||!pack.laps||!Object.keys(pack.laps).length)throw Error('empty identity or laps');
    for(const [lap,data] of Object.entries(pack.laps)){
      if(data.driver!==driver||String(data.lap)!==lap||!Array.isArray(data.samples)||data.samples.length<30)throw Error(`invalid lap ${lap}`);
      const s=data.samples;if(!Number.isFinite(s[0].ElapsedSeconds)||!Number.isFinite(s.at(-1).ElapsedSeconds)||s.at(-1).ElapsedSeconds<=s[0].ElapsedSeconds)throw Error(`invalid lap clock ${lap}`);
      summary.laps++;
    }
    summary.packs++;
  }catch(error){errors.push({identity,error:error.message});}
}
console.log(JSON.stringify({summary,manifestRevision:manifest.revision,sourceRevision:manifest.sourceRevision,packRevision:packs.sourceRevision,errors},null,2));
if(errors.length)process.exitCode=1;

