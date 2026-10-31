// Published snapshots are separate from the live caches: they are observations
// captured at a known time, not fresh API responses with a renewed TTL.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {atomicJson,captureLock} from './atomic-json.mjs';
import {snapshotCompatible,tagCaptureRevisions} from './snapshot-policy.mjs';
import {gzipSync} from 'node:zlib';
import path from 'node:path';

export function captureKey(route){
  const url=new URL(route,'http://local.invalid');
  if(url.origin!=='http://local.invalid'||!/^\/api\/(events|session|performance(?:\/trace-batch|\/pits|\/sprint)?|qualifying-corners|race-corners)$/.test(url.pathname))throw Error('Unsupported captured route');
  for(const key of ['fresh','refresh','_t','t'])url.searchParams.delete(key);
  if(url.pathname==='/api/session')for(const key of ['status','data_schema'])url.searchParams.delete(key);
  url.searchParams.sort();return url.pathname+'?'+url.searchParams;
}

export async function mergeLocalCaptures(root,revisions,items){
  const dir=path.join(root,'assets/data/local-captures'),target=path.join(dir,'index.json');
  await mkdir(dir,{recursive:true});
  return captureLock(root,async()=>{
  const old=await readFile(target,'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  for(const field of ['sourceRevision','backendRevision','measurementRevision'])
    if(old&&!snapshotCompatible(field,old[field],revisions[field]))throw Error(`Captured ${field} differs; rebuild the existing captures before merging.`);
  const index={...old,schema:'apex-local-captures-v1',...revisions,entries:old?tagCaptureRevisions(old):{}};
  for(const item of items){
    const key=captureKey(item.route),capturedAt=item.capturedAt||new Date().toISOString();
    if(!item.data||typeof item.data!=='object'||Number.isNaN(Date.parse(capturedAt)))throw Error('Invalid capture data or timestamp');
    if(Date.parse(index.entries[key]?.capturedAt)>Date.parse(capturedAt))continue;
    const packed=gzipSync(JSON.stringify(item.data),{level:9});
    const file=createHash('sha256').update(packed).digest('hex').slice(0,24)+'.json.gz';
    await writeFile(path.join(dir,file),packed);
    index.entries[key]={file,capturedAt,...revisions};
  }
  index.generated=new Date().toISOString();
  await atomicJson(target,index);
  return index;
  });
}


