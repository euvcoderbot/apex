import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {writeFile} from 'node:fs/promises';
import {stopOwnedBackend} from '../lib/local-process.mjs';
const ui='http://127.0.0.1:54126',api='http://127.0.0.1:54127';
const child=spawn(process.execPath,['scripts/start-local.mjs'],{cwd:process.cwd(),windowsHide:true,stdio:['ignore','pipe','pipe'],
  env:{...process.env,APEX_LOCAL_PORT:'54126',APEX_LOCAL_API_PORT:'54127',APEX_LOCAL_KEEP_ALIVE:'0'}});
let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function alive(url){try{return (await fetch(url,{signal:AbortSignal.timeout(600)})).ok;}catch{return false;}}
async function waitFor(test,timeout=15000){const end=Date.now()+timeout;while(!await test()){if(Date.now()>end)throw Error('Lifecycle condition timed out. '+log);await pause(100);}}
async function lease(id,action){const r=await fetch(ui+'/api/local-tab',{method:'POST',body:JSON.stringify({id,action})});if(!r.ok)throw Error('Lease HTTP '+r.status);return r.json();}
const a='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
try{
  await waitFor(()=>alive(ui+'/api/local-status'),60000);
  await lease(a,'open');await lease(b,'open');await lease(a,'close');await pause(6100);
  if(!await alive(ui+'/api/local-status')||!await alive(api+'/openapi.json'))throw Error('Closing first tab killed another tab');
  // A reload opens a replacement document before the five-second close grace.
  await lease(b,'close');await lease(a,'open');await pause(6100);
  if(!await alive(ui+'/api/local-status'))throw Error('Reload killed compute');
  const start=Date.now();await lease(a,'close');
  await waitFor(async()=>!await alive(ui+'/api/local-status')&&!await alive(api+'/openapi.json'));
  await Promise.race([child.exitCode!==null?Promise.resolve():once(child,'exit'),pause(3000).then(()=>{if(child.exitCode===null)throw Error('Runner did not exit');})]);
  const proof={otherTabSurvived:true,reloadSurvived:true,lastTabStoppedDashboard:true,lastTabStoppedPython:true,
    stoppedAfterMs:Date.now()-start,runnerExit:child.exitCode};
  console.log(JSON.stringify(proof));if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(proof,null,2));
}finally{await stopOwnedBackend(child);}
