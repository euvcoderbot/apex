import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync('local-compute.js','utf8');
function page({url='https://f1apexdata.eufrandota14.chatgpt.site/apex/?year=2026&round=18&session=Practice+2&laps=NOR.3#top',ready=true,local=false,preference}={}){
  const nodes=new Map(),events={},navigation=[],requests=[],timers=new Set(),storage=new Map(preference?[['apex-compute',preference]]:[]);
  function node(){return {textContent:'',hidden:false,disabled:false,attrs:{},events:{},setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k];},removeAttribute(k){delete this.attrs[k];},addEventListener(k,v){this.events[k]=v;},replaceWith(v){nodes.set('status',v);}};}
  for(const s of ['.local-compute-link','[data-local-message]','[data-local-help]','[data-close-local]','[data-local-open]','[data-local-start]','[data-use-hosted]','[data-local-stop]','#localComputeTitle'])nodes.set(s,node());
  const dialog=node();dialog.open=false;dialog.showModal=()=>dialog.open=true;dialog.close=()=>{dialog.open=false;dialog.events.close?.();};dialog.querySelector=s=>nodes.get(s);dialog.querySelectorAll=()=>[nodes.get('[data-local-open]'),nodes.get('[data-local-start]')];nodes.set('#localComputeDialog',dialog);
  const location=new URL(url);location.assign=value=>navigation.push(value);
  const sandbox={URL,Date,AbortSignal,crypto:{randomUUID:()=> 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'},
    location,window:{APEX_LOCAL_MODE:local,addEventListener:(k,v)=>events[k]=v},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    document:{querySelector:s=>nodes.get(s),createElement:node,addEventListener:()=>{}},navigator:{sendBeacon:()=>{}},Blob,
    EventSource:class {close(){}},setInterval:fn=>{timers.add(fn);return fn;},clearInterval:fn=>timers.delete(fn),
    fetch:async(url,options)=>{requests.push([url,options]);if(!ready)throw Error('not reachable');return Response.json(url==='/api/local-stop'?{stopping:true}:{mode:'local',sourceOrigin:'http://127.0.0.1:8000'});}};
  vm.runInNewContext(source,sandbox);
  return {nodes,dialog,navigation,requests,timers,storage,flush:()=>new Promise(resolve=>setImmediate(resolve))};
}
test('healthy companion is reused on load with the exact session, comparison and view',async()=>{
  const p=page();await p.flush();assert.equal(p.navigation.length,1);
  assert.equal(p.navigation[0],'http://127.0.0.1:54123/apex/?year=2026&round=18&session=Practice+2&laps=NOR.3#top');
  assert.equal(p.storage.get('apex-compute'),'local');assert.equal(p.requests.length,1);
});
test('explicit hosted choice does not probe or redirect; a user click opts back into local',async()=>{
  const p=page({url:'https://f1apexdata.eufrandota14.chatgpt.site/apex/cars/corners?compute=hosted&year=2026'});await p.flush();
  assert.equal(p.requests.length,0);assert.equal(p.storage.get('apex-compute'),'hosted');
  await p.nodes.get('.local-compute-link').events.click({preventDefault(){}});
  assert.equal(p.navigation[0],'http://127.0.0.1:54123/apex/cars/corners?year=2026');
});
test('unreachable companion shows explicit launch instructions, never a silent protocol launch',async()=>{
  const p=page({ready:false});await p.flush();assert.equal(p.navigation.length,0);
  await p.nodes.get('.local-compute-link').events.click({preventDefault(){}});assert.equal(p.dialog.open,true);
  p.nodes.get('[data-local-start]').events.click();assert.equal(p.timers.size,1);
  assert.match(p.nodes.get('[data-local-message]').textContent,/Approve the browser prompt/);
  p.dialog.close();assert.equal(p.timers.size,0);assert.equal(p.navigation.length,0);
});
test('local mode exposes on-demand status, safe stop and an explicit hosted escape',async()=>{
  const p=page({local:true,url:'http://127.0.0.1:54123/apex/?year=2026&session=Practice+1'});
  assert.equal(p.nodes.get('status').textContent,'Local compute');assert.match(p.nodes.get('status').title,/On demand/);
  const hosted=new URL(p.nodes.get('[data-use-hosted]').href);assert.equal(hosted.origin,'https://f1apexdata.eufrandota14.chatgpt.site');assert.equal(hosted.searchParams.get('compute'),'hosted');
  await p.nodes.get('[data-local-stop]').events.click();assert.equal(p.requests.at(-1)[1].method,'POST');assert.equal(p.navigation[0],hosted.href);
});
