// Read-only hosted discovery; lifecycle messages exist only inside the local app.
(() => {
  const dashboard='http://127.0.0.1:54123/apex/';
  if(window.APEX_LOCAL_MODE){
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
  const link=document.querySelector('.local-compute-link'),dialog=document.querySelector('#localComputeDialog');
  if(!link||!dialog)return;
  dialog.querySelector('[data-close-local]')?.addEventListener('click',()=>dialog.close());
  link.addEventListener('click',async event=>{
    event.preventDefault();if(link.getAttribute('aria-busy')==='true')return;
    link.setAttribute('aria-busy','true');
    try{
      const r=await fetch('http://127.0.0.1:54123/api/local-status',{signal:AbortSignal.timeout(1500),credentials:'omit'}),data=await r.json();
      if(r.ok&&data.mode==='local'&&data.sourceOrigin==='http://127.0.0.1:8000'){location.assign(dashboard);return;}
    }catch{}
    finally{link.removeAttribute('aria-busy');}
    // No silent custom-scheme redirect, hidden frame or attempt to bypass a
    // browser's external-app/private-network permission. Explain the handoff.
    if(!dialog.open)dialog.showModal();
  });
})();
