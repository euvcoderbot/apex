// Offline metadata migration only. Native times, samples, teams, capture dates
// and original revision identities are never rewritten or recalculated.
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureLock,atomicBytes} from '../lib/atomic-json.mjs';
import {SOURCE_REVISION} from '../lib/cache-revision.mjs';
const root=path.resolve(process.argv[2]||'.');
const script=fileURLToPath(new URL('./audit-prepared-annotations.py',import.meta.url));
const result=spawnSync(process.env.APEX_PYTHON||'python',[script,root,'--patches'],{encoding:'utf8',maxBuffer:32*1024*1024,windowsHide:true});
if(result.status!==0)throw Error(result.stderr||result.stdout||'Offline annotation audit failed');
const patches=JSON.parse(result.stdout),dir=path.join(root,'assets/data/local-captures');
await captureLock(root,async commit=>{
  const index=JSON.parse(await readFile(path.join(dir,'index.json'),'utf8'));
  let changed=0;
  for(const patch of patches){
    const entry=index.entries[patch.route];
    if(entry.file!==patch.file)throw Error('Capture changed during annotation audit; retry.');
    const value=JSON.parse(gunzipSync(await readFile(path.join(dir,entry.file))));
    const original=JSON.stringify(value.drivers.map(d=>({...d,laps:d.laps.map(({red_flag,neutralised,...lap})=>lap)})));
    const annotations=new Map(patch.changes.map(item=>[`${item.driver}:${item.lap}`,item]));
    for(const driver of value.drivers)for(const lap of driver.laps){
      const update=annotations.get(`${driver.code}:${lap.lap}`);
      if(!update)throw Error('Missing lap annotation');
      lap.red_flag=update.red_flag;lap.neutralised=update.neutralised;
    }
    if(original!==JSON.stringify(value.drivers.map(d=>({...d,laps:d.laps.map(({red_flag,neutralised,...lap})=>lap)}))))throw Error('Non-annotation observations changed');
    value.local_export={...value.local_export,annotation_revision:SOURCE_REVISION,annotation_method:'retained-race-control-v1'};
    const packed=gzipSync(JSON.stringify(value),{level:9});
    const file=createHash('sha256').update(packed).digest('hex').slice(0,24)+'.json.gz';
    await atomicBytes(path.join(dir,file),packed);
    index.entries[patch.route]={...entry,file,annotationRevision:SOURCE_REVISION};
    changed++;
  }
  await commit(path.join(dir,'index.json'),index);
  console.log(JSON.stringify({annotated:changed,sourceRevision:SOURCE_REVISION,note:'Original revisions and capturedAt retained; only red_flag/neutralised metadata enriched offline.'}));
});
