// A fixed local app launcher, not a web-accessible command execution service.
export const LOCAL_DASHBOARD='http://127.0.0.1:54123/apex/';
export const LOCAL_STATUS='http://127.0.0.1:54123/api/local-status';

export function validLaunchArguments(args){
  return args.length===0||(args.length===1&&/^apex-local:\/\/start\/?$/i.test(args[0]));
}

export async function localReady(fetcher=fetch){
  try{
    const response=await fetcher(LOCAL_STATUS,{signal:AbortSignal.timeout(1200)});
    if(!response.ok)return false;
    const data=await response.json();
    return data.mode==='local'&&data.sourceOrigin==='http://127.0.0.1:8000';
  }catch{return false;}
}

export async function ensureLocalCompute({ready=localReady,start,open,wait=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now,timeout=60000}){
  const reused=await ready();
  if(!reused){
    await start();
    const deadline=now()+timeout;
    while(!await ready()){
      if(now()>=deadline)throw new Error('Local compute did not become ready. See .apex-cache/launcher/server.log.');
      await wait(250);
    }
  }
  // Never open a dead localhost page or redirect to a URL supplied by a website.
  await open(LOCAL_DASHBOARD);
  return {mode:'local',reused,url:LOCAL_DASHBOARD};
}
