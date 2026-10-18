import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {stopOwnedBackend} from '../lib/local-process.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
const python=process.env.APEX_PYTHON||path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
if(!existsSync(python))throw new Error('Python environment missing. Install requirements into .venv first.');
const uiPort=Number(process.env.APEX_LOCAL_PORT||54123),apiPort=Number(process.env.APEX_LOCAL_API_PORT||8000);
if(![uiPort,apiPort].every(p=>Number.isInteger(p)&&p>=1024&&p<=65535)||uiPort===apiPort)throw new Error('Choose two different unprivileged ports.');
await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['scripts/sync-static.mjs'],{cwd:root,stdio:'inherit',windowsHide:true});child.once('error',reject);child.once('exit',code=>code?reject(new Error('Static bundle sync failed')):resolve());});
// Load revision-bearing modules only after sync generated the current keys.
const {createLocalDashboard}=await import('../lib/local-server.mjs');
const backend=spawn(python,['-m','uvicorn','server:app','--host','127.0.0.1','--port',String(apiPort)],{cwd:root,stdio:'inherit',windowsHide:true,env:{...process.env,APEX_LOCAL_COMPUTE:'1'}});
let closed=false;
const sourceOrigin=`http://127.0.0.1:${apiPort}`;
const {server,tabs}=createLocalDashboard({root:path.join(root,'public/apex'),cacheRoot:path.join(root,'.apex-cache/dashboard'),sourceOrigin,
  ...(process.env.APEX_LOCAL_KEEP_ALIVE==='1'?{}:{onIdle:()=>{console.log('Last local dashboard tab closed; stopping local compute.');void close();}})});
async function close(code=0){if(closed)return;closed=true;tabs.dispose();server.close();server.closeAllConnections();await stopOwnedBackend(backend);process.exitCode=code;}
backend.once('error',error=>{console.error(error.message);close(1);});
backend.once('exit',code=>{if(!closed){console.error('Local parser stopped.');close(code||1);}});
process.on('SIGINT',()=>close());process.on('SIGTERM',()=>close());
server.once('error',error=>{console.error(error.message);close(1);});
// Do not print a usable URL until the local parser actually responds.
const deadline=Date.now()+45000;
while(!closed){try{const r=await fetch(sourceOrigin+'/openapi.json',{signal:AbortSignal.timeout(1500)});if(r.ok)break;}catch{}
  if(Date.now()>deadline){close(1);throw new Error('Local parser did not start within 45 seconds.');}
  await new Promise(resolve=>setTimeout(resolve,250));
}
if(!closed)server.listen(uiPort,'127.0.0.1',()=>{
  console.log(`Local: http://127.0.0.1:${uiPort}/apex/`);
  console.log('Compute: this PC. Cache: .apex-cache/dashboard + Python source caches. Vercel: not used.');
  console.log('Closing the last local dashboard tab stops both services after a 5-second reload grace. Cached data remains on disk.');
});
