import {execFile} from 'node:child_process';
export async function stopOwnedBackend(child,{platform=process.platform,run=execFile}={}){
  if(!child||child.exitCode!==null||!Number.isInteger(child.pid)||child.pid<=0||child.pid===process.pid)return;
  if(platform==='win32'){
    // venv python.exe owns a second Python process on Windows. Kill only this
    // spawned child's tree, never every process named Python or a port owner.
    await new Promise(resolve=>run('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true},()=>resolve()));
  }else child.kill('SIGTERM');
}
