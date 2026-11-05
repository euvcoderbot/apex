// Offline metadata migration only. Native times, samples, teams, capture dates
// and original revision identities are never rewritten or recalculated.
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {captureLock,atomicBytes} from '../lib/atomic-json.mjs';
import {SOURCE_REVISION} from '../lib/cache-revision.mjs';
const root=path.resolve(process.argv[2]||'.');
const folder=process.argv.includes('--folder')?process.argv[process.argv.indexOf('--folder')+1]:'local-captures';
if(!['local-captures','prerendered'].includes(folder))throw Error('Unsupported capture folder');
const script=fileURLToPath(new URL('./audit-prepared-annotations.py',import.meta.url));
if(process.argv.includes('--fetch-missing-controls')){
  const audit=spawnSync(process.env.APEX_PYTHON||'python',[script,root,'--folder',folder],{encoding:'utf8',maxBuffer:32*1024*1024,windowsHide:true});
  if(audit.status!==0)throw Error(audit.stderr||'Metadata inventory failed');
  for(const item of JSON.parse(audit.stdout).filter(item=>item.missing_raw)){
    if(!Number.isSafeInteger(item.session)||item.session<=0)throw Error('Invalid metadata session');
    const url=`https://api.openf1.org/v1/race_control?session_key=${item.session}`;
    const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error('Race-control metadata HTTP '+response.status);
    const bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.length>1024*1024)throw Error('Race-control metadata exceeds budget');
    const rows=JSON.parse(bytes);
    if(!Array.isArray(rows)||!rows.length||rows.some(row=>Number(row.session_key)!==item.session))throw Error('Wrong race-control session');
    const name=createHash('sha256').update(url).digest('hex')+'.json.gz';
    await atomicBytes(path.join(os.homedir(),'apex-data/openf1',name),gzipSync(bytes,{level:9}));
    console.log('Retained race-control metadata only: '+item.session);
  }
}
const result=spawnSync(process.env.APEX_PYTHON||'python',[script,root,'--patches','--folder',folder],{encoding:'utf8',maxBuffer:32*1024*1024,windowsHide:true});
if(result.status!==0)throw Error(result.stderr||result.stdout||'Offline annotation audit failed');
const patches=JSON.parse(result.stdout),dir=path.join(root,'assets/data',folder);
await captureLock(root,async commit=>{
  const index=JSON.parse(await readFile(path.join(dir,'index.json'),'utf8'));
  let changed=0;
  for(const patch of patches){
    const entry=index.entries[patch.route];
    const filename=typeof entry==='string'?entry:entry.file;
    if(filename!==patch.file)throw Error('Capture changed during annotation audit; retry.');
    const value=JSON.parse(gunzipSync(await readFile(path.join(dir,filename))));
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
    if(typeof entry==='string'){
      index.entries[patch.route]=file;
      index.captures={...index.captures,[patch.route]:{...index.captures?.[patch.route],annotationRevision:SOURCE_REVISION}};
    }else index.entries[patch.route]={...entry,file,annotationRevision:SOURCE_REVISION};
    changed++;
  }
  await commit(path.join(dir,'index.json'),index);
  console.log(JSON.stringify({annotated:changed,sourceRevision:SOURCE_REVISION,note:'Original revisions and capturedAt retained; only red_flag/neutralised metadata enriched offline.'}));
});
