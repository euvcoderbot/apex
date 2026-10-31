// Read-only publication gate: no missing/corrupt files or silently relabelled data.
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {SOURCE_REVISION,BACKEND_REVISION,RACE_REVISION} from '../lib/cache-revision.mjs';
import {snapshotCompatible} from '../lib/snapshot-policy.mjs';
const revisions={sourceRevision:SOURCE_REVISION,backendRevision:BACKEND_REVISION,measurementRevision:RACE_REVISION};
const root=path.resolve('assets/data');
const read=async file=>JSON.parse(await readFile(file,'utf8'));
let files=0,retained=0;
function requireRevision(family,revision){
  if(!snapshotCompatible(family,revision,revisions[family]))throw Error(`Unsupported ${family}: ${revision}`);
  if(revision!==revisions[family])retained++;
}
async function payload(folder,file){
  if(!/^[a-f0-9]{24}\.json\.gz$/.test(file))throw Error('Invalid snapshot filename: '+file);
  const value=JSON.parse(gunzipSync(await readFile(path.join(root,folder,file))));
  if(!value||typeof value!=='object')throw Error('Invalid snapshot object: '+file);
  files++;return value;
}
const captures=await read(path.join(root,'local-captures/index.json'));
for(const [key,entry] of Object.entries(captures.entries||{})){
  const family=/^\/api\/(events|session)\?/.test(key)?'sourceRevision':/^\/api\/(qualifying|race)-corners\?/.test(key)?'measurementRevision':'backendRevision';
  requireRevision(family,entry[family]||captures[family]);
  if(!Number.isFinite(Date.parse(entry.capturedAt)))throw Error('Missing capture time: '+key);
  await payload('local-captures',entry.file);
}
for(const folder of ['prerendered','local-telemetry','telemetry']){
  const index=await read(path.join(root,folder,'index.json'));
  requireRevision('sourceRevision',index.sourceRevision);
  if(index.revision)requireRevision('backendRevision',index.revision);
  for(const file of new Set(Object.values(index.entries||{})))await payload(folder,file);
}
console.log(`Release snapshots valid: ${files} referenced files checked; ${retained} retained revision references keep their original provenance.`);
