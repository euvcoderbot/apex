import {rename, unlink, mkdir, open} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';

/** Readers see either the previous complete document or the new one. */
export async function atomicJson(target, value) {
  return atomicBytes(target,JSON.stringify(value));
}

export async function atomicBytes(target,body) {
  const temporary = target + '.' + randomUUID() + '.tmp';
  try {
    const handle=await open(temporary,'wx');
    try{await handle.writeFile(body);await handle.sync();}finally{await handle.close();}
    await rename(temporary, target);
    if(process.platform!=='win32'){
      const directory=await open(path.dirname(target),'r');
      try{await directory.sync();}finally{await directory.close();}
    }
  }
  finally { await unlink(temporary).catch(() => {}); }
}

/** Shared with the Python capture exporter. Never steal an active writer's lock. */
export async function captureLock(root, run) {
  const dir = path.join(root, 'assets/data/local-captures');
  await mkdir(dir, {recursive: true});
  const repo=fileURLToPath(new URL('../',import.meta.url));
  const venv=path.join(repo,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  const python=process.env.APEX_LOCK_PYTHON||process.env.APEX_PYTHON||(existsSync(venv)?venv:'python');
  const child=spawn(python,[path.join(repo,'capture_storage.py'),dir],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let diagnostics='';child.stderr.on('data',chunk=>{diagnostics=(diagnostics+chunk).slice(-4000);});
  child.stdin.on('error',()=>{});
  const exited=new Promise(resolve=>child.once('close',resolve));
  let timer;
  try { await new Promise((resolve,reject)=>{
    let output='';
    timer=setTimeout(()=>{child.kill();reject(Error('Capture lock helper did not respond within 10 seconds'));},10000);
    child.once('error',reject);
    child.once('close',()=>reject(Error(diagnostics||'Capture lock helper exited before acquiring ownership')));
    child.stdout.on('data',chunk=>{output+=chunk;if(/LOCKED\r?\n/.test(output))resolve();});
  }); } catch(error){child.stdin.end();child.kill();throw error;}
  finally{clearTimeout(timer);}
  try { return await run(); }
  finally { child.stdin.end();await exited; }
}
