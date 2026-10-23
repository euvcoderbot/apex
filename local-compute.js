// Read-only hosted discovery; lifecycle messages exist only inside the local app.
(() => {
  const dashboard='http://127.0.0.1:54123/apex/';
  const hosted='https://f1apexdata.eufrandota14.chatgpt.site';
  const dialog=document.querySelector('#localComputeDialog');
  const preference=value=>{try{if(value)localStorage.setItem('apex-compute',value);return localStorage.getItem('apex-compute');}catch{return null;}};
  const target=origin=>{const current=new URL(location.href),url=new URL(current.pathname+current.search+current.hash,origin);url.searchParams.delete('compute');return url;};
  const message=text=>{const box=dialog?.querySelector('[data-local-message]');if(box)box.textContent=text;};
  let watching;
  const stopWatching=()=>{clearInterval(watching);watching=null;};
  dialog?.addEventListener('close',stopWatching);
  dialog?.querySelector('[data-close-local]')?.addEventListener('click',()=>dialog.close());
  if(window.APEX_LOCAL_MODE){
    const link=document.querySelector('.local-compute-link');
    if(link){
      const status=document.createElement('button');status.type='button';status.className='local-compute-status';
      status.textContent='Local compute';status.title='On demand: requests are processed on this PC and cached on disk. Click for compute options.';
      status.addEventListener('click',()=>dialog?.showModal());link.replaceWith(status);
    }
    if(dialog){
      dialog.querySelector('#localComputeTitle').textContent='Local compute is ready';
      message('Data is fetched and processed on this PC when requested, then cached on disk. The installed launcher keeps compute available even after you close the dashboard.');
      dialog.querySelector('[data-local-help]').textContent='No export or deployment is needed for local results. This PC must remain awake and connected to fetch new data.';
      dialog.querySelectorAll('[data-local-open],[data-local-start]').forEach(node=>node.hidden=true);
      const hostedLink=dialog.querySelector('[data-use-hosted]'),url=target(hosted);url.searchParams.set('compute','hosted');hostedLink.href=url.href;hostedLink.hidden=false;
      const stop=dialog.querySelector('[data-local-stop]');stop.hidden=false;
      stop.addEventListener('click',async()=>{
        stop.disabled=true;
        try{const r=await fetch('/api/local-stop',{method:'POST'});if(!r.ok)throw new Error((await r.json()).detail);location.assign(url.href);}
        catch(error){message('Could not stop local compute: '+error.message);stop.disabled=false;}
      });
    }
    const id=crypto.randomUUID();let leaving=false,connection;
    const send=action=>fetch('/api/local-tab',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,action}),keepalive:true}).catch(()=>{});
    const heartbeat=()=>{if(!leaving&&!connection)void send('heartbeat');};
    const connect=()=>{connection?.close();if(typeof EventSource==='function')connection=new EventSource('/api/local-tab-stream?id='+encodeURIComponent(id));};
    connect();if(!connection)void send('open');let timer=setInterval(heartbeat,15000);
    window.addEventListener('pagehide',()=>{leaving=true;clearInterval(timer);connection?.close();navigator.sendBeacon('/api/local-tab',new Blob([JSON.stringify({id,action:'close'})],{type:'application/json'}));});
    window.addEventListener('pageshow',()=>{leaving=false;clearInterval(timer);timer=setInterval(heartbeat,15000);if(!connection||connection.readyState===2)connect();heartbeat();});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')heartbeat();});
    return;
  }
  const link=document.querySelector('.local-compute-link');
  if(!link||!dialog)return;
  const localTarget=target(dashboard).href;
  link.href=localTarget;dialog.querySelector('[data-local-open]').href=localTarget;
  async function connect(){
    try{
      const r=await fetch('http://127.0.0.1:54123/api/local-status',{signal:AbortSignal.timeout(1500),credentials:'omit'}),data=await r.json();
      if(r.ok&&data.mode==='local'&&data.sourceOrigin==='http://127.0.0.1:8000'){
        stopWatching();preference('local');location.assign(localTarget);return true;
      }
    }catch{}
    return false;
  }
  link.addEventListener('click',async event=>{
    event.preventDefault();if(link.getAttribute('aria-busy')==='true')return;
    link.setAttribute('aria-busy','true');
    try{if(await connect())return;}
    finally{link.removeAttribute('aria-busy');}
    // No silent custom-scheme redirect, hidden frame or attempt to bypass a
    // browser's external-app/private-network permission. Explain the handoff.
    if(!dialog.open)dialog.showModal();
  });
  dialog.querySelector('[data-local-start]').addEventListener('click',()=>{
    // The explicit link invokes the installed launcher only with browser permission.
    // Watch readiness, then preserve the current session/view in the handoff.
    stopWatching();message('Waiting for the installed launcher. Approve the browser prompt if shown. This page will connect when compute is ready.');
    const deadline=Date.now()+120000;let checking=false;
    watching=setInterval(async()=>{
      if(checking)return;
      if(Date.now()>deadline){stopWatching();message('The launcher did not become reachable. In the Codex in-app browser, start the installed launcher from your normal browser or run start-local.cmd, then click Use local compute again.');return;}
      checking=true;try{await connect();}finally{checking=false;}
    },1500);
  });
  const explicitHosted=new URL(location.href).searchParams.get('compute')==='hosted';
  if(explicitHosted)preference('hosted');
  // A running companion is reused automatically; never silently start software.
  if(location.origin===hosted&&!explicitHosted&&preference()!=='hosted')void connect();
})();
