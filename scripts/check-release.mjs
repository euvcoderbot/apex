// Read-only publication gate: no missing/corrupt files or silently relabelled data.
import {readFile,stat} from 'node:fs/promises';
import {validateIndex,decodeSnapshot,validatePayload} from '../lib/release-validation.mjs';
import path from 'node:path';
import {SOURCE_REVISION,BACKEND_REVISION,RACE_REVISION} from '../lib/cache-revision.mjs';
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
function requireRevision(family,revision){
  if(!snapshotCompatible(family,revision,revisions[family]))throw Error(`Unsupported ${family}: ${revision}`);
  if(revision!==revisions[family])retained++;
}
async function payload(folder,file,route=''){
  if(!/^[a-f0-9]{24}\.json\.gz$/.test(file))throw Error('Invalid snapshot filename: '+file);
  const filename=path.join(root,folder,file);
  if((await stat(filename)).size>32*1024*1024)throw Error('Compressed snapshot exceeds release budget: '+file);
  const value=decodeSnapshot(await readFile(filename));
  validatePayload(value,folder,route);
  files++;return value;
}
const captures=await indexFor('local-captures');
if(captures)validateIndex(captures,'local-captures');
for(const [key,entry] of Object.entries(captures?.entries||{})){
  const family=/^\/api\/(events|session)\?/.test(key)?'sourceRevision':/^\/api\/(qualifying|race)-corners\?/.test(key)?'measurementRevision':'backendRevision';
  requireRevision(family,entry[family]||captures[family]);
  if(!Number.isFinite(Date.parse(entry.capturedAt)))throw Error('Missing capture time: '+key);
  await payload('local-captures',entry.file,key);
}
for(const folder of ['prerendered','local-telemetry','telemetry']){
  const index=await indexFor(folder);
  if(!index)continue;
  validateIndex(index,folder);
  requireRevision('sourceRevision',index.sourceRevision);
  if(index.revision)requireRevision('backendRevision',index.revision);
  for(const [route,file] of Object.entries(index.entries)){
    if(index.entrySourceRevisions?.[route])requireRevision('sourceRevision',index.entrySourceRevisions[route]);
    await payload(folder,file,folder==='prerendered'?route:'');
  }
}
console.log(`${sourceOnly?'Source recordings':'Release snapshots'} valid: ${files} referenced files checked; ${retained} retained revision references keep their original provenance.`);
