import {spawn} from 'node:child_process';
import {mkdir,open,readFile,unlink,stat,appendFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {validLaunchArguments,ensureLocalCompute,localReady} from '../lib/local-launcher.mjs';

if(!validLaunchArguments(process.argv.slice(2)))throw new Error('Only apex-local://start is supported.');
if(process.platform!=='win32')throw new Error('The one-click launcher currently supports Windows.');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const logs=path.join(root,'.apex-cache/launcher'),lock=path.join(logs,'launch.lock'),token=randomUUID();
await mkdir(logs,{recursive:true});
let owned=false;
try{
  // Coalesce simultaneous protocol activations; never launch competing parsers.
  try{const age=Date.now()-(await stat(lock)).mtimeMs;if(age>120000)await unlink(lock);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!await localReady()){
    try{const handle=await open(lock,'wx');await handle.writeFile(token);await handle.close();owned=true;}
    catch(e){if(e.code!=='EEXIST')throw e;}
  }
  const result=await ensureLocalCompute({
    start:async()=>{
      if(!owned)return;
      const output=await open(path.join(logs,'server.log'),'a');
      try{
        const child=spawn(process.execPath,[path.join(root,'scripts/start-local.mjs')],{
          cwd:root,detached:true,windowsHide:true,stdio:['ignore',output.fd,output.fd],
          env:{...process.env,APEX_LOCAL_PORT:'54123',APEX_LOCAL_API_PORT:'8000',APEX_LOCAL_KEEP_ALIVE:'1'}});
        await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
        child.unref();
      }finally{await output.close();}
    },
    open:async url=>{
      // Allows startup verification in headless environments; never set by a URI.
      if(process.env.APEX_LAUNCHER_NO_BROWSER==='1')return;
      const child=spawn('explorer.exe',[url],{windowsHide:true,stdio:'ignore'});
      await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
      child.unref();
    }
  });
  await appendFile(path.join(logs,'launcher.log'),JSON.stringify({at:new Date().toISOString(),...result})+'\n');
}catch(error){
  await appendFile(path.join(logs,'launcher.log'),JSON.stringify({at:new Date().toISOString(),error:error.message})+'\n');
  throw error;
}finally{
  if(owned&&await readFile(lock,'utf8').catch(()=>null)===token)await unlink(lock);
}
