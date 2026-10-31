import test from 'node:test';
import assert from 'node:assert/strict';
import {createDataCache} from '../lib/data-cache.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('an older cold calculation cannot overwrite a newer manual refresh',async()=>{
  const store=new Map(),old=deferred();
  const cache=createDataCache({read:async k=>store.get(k),write:async(k,v)=>store.set(k,v)});
  const cold=cache.result('test',()=>old.promise);
  await Promise.resolve();await Promise.resolve();
  await cache.result('test',async()=>({version:2}),{fresh:true});
  old.resolve({version:1});assert.equal((await cold).ttl,0,'Superseded responses cannot become CDN entries');
  assert.equal((await cache.peek('test')).data.version,2);
  assert.equal(store.get('test').data.version,2);
});

test('cold-work admission is bounded while warm hits and coalesced work remain usable',async()=>{
  const gate=deferred(),started=deferred();let count=0;
  const cache=createDataCache({read:async()=>null,write:async()=>{}});
  await cache.result('warm',async()=>({version:0}));
  const jobs=Array.from({length:256},(_,i)=>cache.result('cold'+i,()=>{if(++count===256)started.resolve();return gate.promise;}));
  await started.promise;
  await assert.rejects(cache.result('overflow',async()=>({})),error=>error.status===429);
  assert.equal((await cache.result('warm',()=>{throw Error('warm hit recomputed');})).cache,'HIT');
  const same=cache.result('cold0',()=>{throw Error('coalesced work recomputed');});
  gate.resolve({version:1});await Promise.all([...jobs,same]);
});

test('slow durable writes complete in order so old storage cannot win last',async()=>{
  const store=new Map(),started=deferred(),release=deferred();
  const cache=createDataCache({read:async k=>store.get(k),write:async(k,v)=>{
    if(v.data.version===1){started.resolve();await release.promise;}store.set(k,v);
  }});
  const cold=cache.result('test',async()=>({version:1}));await started.promise;
  const fresh=cache.result('test',async()=>({version:2}),{fresh:true});
  await new Promise(r=>setTimeout(r,10));release.resolve();await Promise.all([cold,fresh]);
  assert.equal(store.get('test').data.version,2);
});
