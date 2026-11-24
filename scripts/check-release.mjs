// Read-only publication gate: no missing/corrupt files or silently relabelled data.
import {readFile,readdir,stat} from 'node:fs/promises';
import {validateIndex,decodeSnapshot,validatePayload,validateSeasonIndex,validateSeasonPayload} from '../lib/release-validation.mjs';
import path from 'node:path';
import {SOURCE_REVISION,BACKEND_REVISION,RACE_REVISION,RETIREMENT_REVISION} from '../lib/cache-revision.mjs';
import {isRacePerformanceRoute} from '../lib/retirement-revision.mjs';
import {snapshotCompatible} from '../lib/snapshot-policy.mjs';
const revisions={sourceRevision:SOURCE_REVISION,backendRevision:BACKEND_REVISION,measurementRevision:RACE_REVISION};
const root=path.resolve('assets/data');
const read=async file=>JSON.parse(await readFile(file,'utf8'));
// Main contains source/curated recordings. Prepared local output is staged
// only in the Site checkout. Publication never uses this source-only option.
const sourceOnly=process.argv.includes('--source');
async function indexFor(folder){
  try{return await read(path.join(root,folder,'index.json'));}
  catch(error){
    if(sourceOnly&&error.code==='ENOENT'&&['local-captures','local-telemetry'].includes(folder))return null;
    throw error;
  }
}
let files=0,retained=0;
function requireRevision(family,revision,{recording=false}={}){
  // Source CI validates the integrity of committed historical recordings, not
  // their suitability for publication under the current calculation code.
  // The ordinary release gate always requires explicit compatibility.
  if(sourceOnly&&recording){
    if(!/^[a-f0-9]{20}$/.test(revision||''))throw Error(`Invalid ${family}: ${revision}`);
    if(revision!==revisions[family])retained++;
    return;
  }
  if(!snapshotCompatible(family,revision,revisions[family]))throw Error(`Unsupported ${family}: ${revision}`);
  if(revision!==revisions[family])retained++;
}
async function payload(folder,file,route=''){
  if(!/^[a-f0-9]{24}\.json\.gz$/.test(file))throw Error('Invalid snapshot filename: '+file);
  const filename=path.join(root,folder,file);
  if((await stat(filename)).size>32*1024*1024)throw Error('Compressed snapshot exceeds release budget: '+file);
  const value=decodeSnapshot(await readFile(filename));
  if(!sourceOnly&&isRacePerformanceRoute(route)&&!snapshotCompatible('retirementRevision',value.retirement_annotation_revision,RETIREMENT_REVISION))
    throw Error('Race retirement classifications need rebuilding: '+route);
  validatePayload(value,folder,route);
  files++;return value;
}
const captures=await indexFor('local-captures');
if(captures)validateIndex(captures,'local-captures');
for(const [key,entry] of Object.entries(captures?.entries||{})){
  const family=/^\/api\/(events|session)\?/.test(key)?'sourceRevision':/^\/api\/(qualifying|race)-corners\?/.test(key)?'measurementRevision':'backendRevision';
  requireRevision(family,entry[family]||captures[family]);
  if(!Number.isFinite(Date.parse(entry.capturedAt)))throw Error('Missing capture time: '+key);
  const value=await payload('local-captures',entry.file,key);
  if(family==='sourceRevision'&&value.openf1_session_key&&(entry.sourceRevision||captures.sourceRevision)!==SOURCE_REVISION&&!snapshotCompatible('sourceRevision',value.local_export?.annotation_revision,SOURCE_REVISION))
    throw Error('Retained OpenF1 session needs current offline race-control annotations: '+key);
}
for(const folder of ['prerendered','local-telemetry','telemetry']){
  const index=await indexFor(folder);
  if(!index)continue;
  validateIndex(index,folder);
  const recording=folder==='prerendered'||folder==='telemetry';
  requireRevision('sourceRevision',index.sourceRevision,{recording});
  if(index.revision)requireRevision('backendRevision',index.revision,{recording});
  for(const [route,file] of Object.entries(index.entries)){
    if(index.entrySourceRevisions?.[route])requireRevision('sourceRevision',index.entrySourceRevisions[route],{recording});
    const value=await payload(folder,file,folder==='prerendered'?route:'');
    if(!sourceOnly&&folder==='prerendered'&&value.openf1_session_key&&index.sourceRevision!==SOURCE_REVISION&&!snapshotCompatible('sourceRevision',value.local_export?.annotation_revision,SOURCE_REVISION))
      throw Error('Historical OpenF1 session needs current offline race-control annotations: '+route);
  }
}
// Season hub snapshots: committed with the source and read first by the hosted site (no backend for new data),
// so they are checked in both modes whenever the folder exists.
let seasonFiles=0;
const season=await read(path.join(root,'season','index.json')).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
if(season){
  validateSeasonIndex(season);
  for(const [route,entry] of Object.entries(season.entries)){
    validateSeasonPayload(await payload('season',entry.file,route),route);
    seasonFiles++;
  }
}
const trackProfilesDir=path.join(root,'track-profiles');
for(const file of await readdir(trackProfilesDir).catch(error=>{if(error.code==='ENOENT')return [];throw error;})){
  if(!/^\d{4}\.json$/.test(file))continue;
  const value=await read(path.join(trackProfilesDir,file));
  if(value?.year!==Number(file.slice(0,4)) || !value.tracks || Array.isArray(value.tracks) || !Object.keys(value.tracks).length ||
    Object.values(value.tracks).some(t=>!Number.isFinite(t?.lap_time)||t.lap_time<=0||!Number.isFinite(t.length)||t.length<=0||!Array.isArray(t.corners?.list)||!Array.isArray(t.map?.outline)||
      (t.map.pedals!=null&&(typeof t.map.pedals!=='string'||t.map.pedals.length!==t.map.outline.length||!/^[fpbc?]+$/.test(t.map.pedals)))))
    throw new Error('Invalid track profiles: '+file);
}
console.log(`${sourceOnly?'Source recordings structurally valid (publication compatibility not checked)':'Release snapshots valid'}: ${files} referenced files checked (${seasonFiles} season snapshots); ${retained} retained revision references keep their original provenance.`);
