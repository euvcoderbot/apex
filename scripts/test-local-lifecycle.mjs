import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {createLocalDashboard} from '../lib/local-server.mjs';
import {createTabLeases} from '../lib/local-tabs.mjs';
import {stopOwnedBackend} from '../lib/local-process.mjs';
const a='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
test('last tab closes after grace, but another tab and a page reload keep compute alive',()=>{
  let now=0,stops=0;const leases=createTabLeases({now:()=>now,onEmpty:()=>stops++,graceMs:5,ttlMs:100,startupMs:50,pollMs:0});
  leases.touch(a);leases.touch(b);leases.release(a);now=10;leases.check();assert.equal(stops,0);
  leases.release(b);now=12;leases.touch(a);now=20;leases.check();assert.equal(stops,0);
  leases.release(a);now=26;leases.check();leases.check();assert.equal(stops,1);
});
test('a vanished/crashed tab expires and a launcher with no opened tab does not run forever',()=>{
  let now=0,stops=0;const leases=createTabLeases({now:()=>now,onEmpty:()=>stops++,graceMs:5,ttlMs:20,startupMs:50,pollMs:0});
  leases.touch(a);now=21;leases.check();now=26;leases.check();assert.equal(stops,1);
  now=0;stops=0;const cold=createTabLeases({now:()=>now,onEmpty:()=>stops++,startupMs:50,pollMs:0});now=49;cold.check();assert.equal(stops,0);now=50;cold.check();assert.equal(stops,1);
});
test('only known lease actions with bounded document ids are accepted',()=>{
  const leases=createTabLeases({pollMs:0});assert.equal(leases.touch('bad'),false);assert.equal(leases.release('bad'),false);assert.equal(leases.touch(a),true);assert.equal(leases.state().activeTabs,1);
});
test('a live tab transport is not expired by background timer throttling or a sleep clock jump',()=>{
  let now=0,connected=true;const leases=createTabLeases({now:()=>now,pollMs:0,ttlMs:20,isConnected:()=>connected});
  leases.touch(a);now=999999;leases.check();assert.equal(leases.state().activeTabs,1);connected=false;leases.check();assert.equal(leases.state().activeTabs,0);
});
test('Windows shutdown targets only the owned backend process tree',async()=>{
  const calls=[];await stopOwnedBackend({pid:123,exitCode:null},{platform:'win32',run:(...args)=>{calls.push(args.slice(0,3));args[3]();}});
  assert.deepEqual(calls,[['taskkill.exe',['/PID','123','/T','/F'],{windowsHide:true}]]);
  await stopOwnedBackend({pid:process.pid,exitCode:null},{platform:'win32',run:()=>assert.fail('must not kill parent')});
});
test('lifecycle API is same-origin only; hosted discovery cannot create or close a lease',async()=>{
  let stops=0;const local=createLocalDashboard({root:'.',cacheRoot:'.',onIdle:()=>stops++,tabOptions:{pollMs:0}});
  local.server.listen(0,'127.0.0.1');await once(local.server,'listening');const origin='http://127.0.0.1:'+local.server.address().port;
  const body=JSON.stringify({id:a,action:'open'});
  try{
    let r=await fetch(origin+'/api/local-tab',{method:'POST',body,headers:{Origin:'https://evil.test'}});assert.equal(r.status,403);
    r=await fetch(origin+'/api/local-tab',{method:'POST',body,headers:{Origin:'https://f1apexdata.eufrandota14.chatgpt.site'}});assert.equal(r.status,403);
    r=await fetch(origin+'/api/local-status',{headers:{Origin:'https://f1apexdata.eufrandota14.chatgpt.site'}});assert.equal(r.status,200);assert.equal(r.headers.get('access-control-allow-origin'),'https://f1apexdata.eufrandota14.chatgpt.site');
    assert.equal((await r.json()).activeTabs,0);
    r=await fetch(origin+'/api/local-status',{method:'OPTIONS',headers:{Origin:'https://f1apexdata.eufrandota14.chatgpt.site','Access-Control-Request-Private-Network':'true'}});assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-private-network'),'true');
    r=await fetch(origin+'/api/local-status',{method:'OPTIONS',headers:{Origin:'https://evil.test','Access-Control-Request-Private-Network':'true'}});assert.equal(r.status,403);assert.equal(r.headers.get('access-control-allow-private-network'),null);
    r=await fetch(origin+'/api/local-tab',{method:'POST',body});assert.equal(r.status,200);assert.equal((await r.json()).activeTabs,1);
    r=await fetch(origin+'/api/local-tab',{method:'POST',body:JSON.stringify({id:a,action:'close'})});assert.equal((await r.json()).activeTabs,0);assert.equal(stops,0);
    assert.equal((await fetch(origin+'/api/local-tab')).status,405);
  }finally{await new Promise(r=>local.server.close(r));}
});
test('status messages have horizontal text clearance and local navigation is not a silent scheme launch',async()=>{
  const css=await readFile('ui-controls.css','utf8'),page=await readFile('index.html','utf8'),client=await readFile('local-compute.js','utf8');
  assert.match(css,/performance-quality-status[^}]*padding: 8px 12px/);assert.match(css,/performance-quality-status[^}]*overflow-wrap: anywhere/);
  assert.match(page,/class="local-compute-link" href="http:\/\/127\.0\.0\.1:54123\/apex\/"/);
  assert.match(client,/pagehide/);assert.match(client,/navigator\.sendBeacon/);assert.match(client,/pageshow/);
  assert.match(client,/new EventSource/);
  assert.doesNotMatch(client,/location\.(?:assign|href).*apex-local|iframe|window\.open/);
  assert.match(client,/dialog\.showModal/);assert.match(await readFile('scripts/sync-static.mjs','utf8'),/"local-compute\.js"/);
});
test('a tab transport disconnect releases its lease even without unload or a beacon',async()=>{
  const local=createLocalDashboard({root:'.',cacheRoot:'.',onIdle:()=>{},tabOptions:{pollMs:0}});
  local.server.listen(0,'127.0.0.1');await once(local.server,'listening');const origin='http://127.0.0.1:'+local.server.address().port;
  try{
    const r=await fetch(origin+'/api/local-tab-stream?id='+a),reader=r.body.getReader();
    await reader.read();assert.equal(local.tabs.state().activeTabs,1);await reader.cancel();
    const end=Date.now()+1000;while(local.tabs.state().activeTabs&&Date.now()<end)await new Promise(r=>setTimeout(r,5));
    assert.equal(local.tabs.state().activeTabs,0);
  }finally{local.server.closeAllConnections();await new Promise(r=>local.server.close(r));}
});

test('persistent mode survives closed tabs and only an explicit same-origin POST stops it',async()=>{
  let stops=0;const local=createLocalDashboard({root:'.',cacheRoot:'.',onStop:()=>stops++,tabOptions:{pollMs:0}});
  local.server.listen(0,'127.0.0.1');await once(local.server,'listening');const origin='http://127.0.0.1:'+local.server.address().port;
  try{
    const state=await fetch(origin+'/api/local-status').then(r=>r.json());assert.equal(state.autoStop,false);
    local.tabs.touch(a);local.tabs.release(a);local.tabs.check();assert.equal(stops,0);
    assert.equal((await fetch(origin+'/api/local-stop')).status,405);
    assert.equal((await fetch(origin+'/api/local-stop',{method:'POST'})).status,403);
    assert.equal((await fetch(origin+'/api/local-stop',{method:'POST',headers:{Origin:'https://f1apexdata.eufrandota14.chatgpt.site'}})).status,403);
    const response=await fetch(origin+'/api/local-stop',{method:'POST',headers:{Origin:origin}});assert.equal(response.status,200);await response.json();
    await new Promise(resolve=>setImmediate(resolve));assert.equal(stops,1);
  }finally{local.server.closeAllConnections();await new Promise(r=>local.server.close(r));}
});
