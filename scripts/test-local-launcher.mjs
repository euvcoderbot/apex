import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validLaunchArguments,ensureLocalCompute,localReady,LOCAL_DASHBOARD} from '../lib/local-launcher.mjs';

test('protocol accepts only the fixed local start action, never commands, URLs or extra arguments',()=>{
  for(const args of [[],['apex-local://start'],['apex-local://start/']])assert.equal(validLaunchArguments(args),true);
  for(const args of [['https://evil.test'],['apex-local://start?command=calc'],['apex-local://start','--eval=bad'],['apex-local://stop'],['apex-local://start/../../bad']])assert.equal(validLaunchArguments(args),false);
});
test('a cold click starts compute, waits for readiness and then opens the fixed dashboard',async()=>{
  const events=[];let checks=0;
  const result=await ensureLocalCompute({ready:async()=>++checks>=3,start:async()=>events.push('start'),wait:async()=>events.push('wait'),open:async url=>events.push(url)});
  assert.deepEqual(events,['start','wait',LOCAL_DASHBOARD]);assert.equal(result.reused,false);
});
test('a warm click reuses local compute without spawning duplicate processes',async()=>{
  const result=await ensureLocalCompute({ready:async()=>true,start:async()=>assert.fail('duplicate start'),open:async url=>assert.equal(url,LOCAL_DASHBOARD)});
  assert.equal(result.reused,true);
});
test('startup failure never opens a dead page',async()=>{
  let clock=0;
  await assert.rejects(ensureLocalCompute({ready:async()=>false,start:async()=>{},wait:async()=>clock+=250,now:()=>clock,timeout:500,open:async()=>assert.fail('dead page')}),/did not become ready/);
});
test('only a healthy loopback compute service counts as ready',async()=>{
  assert.equal(await localReady(async()=>Response.json({mode:'local',sourceOrigin:'http://127.0.0.1:8000'})),true);
  assert.equal(await localReady(async()=>Response.json({mode:'hosted',sourceOrigin:'https://evil.test'})),false);
  assert.equal(await localReady(async()=>{throw Error('offline');}),false);
});
test('published action uses the installed protocol and registration cannot change system policy',async()=>{
  const page=await readFile('index.html','utf8'),install=await readFile('scripts/install-local-launcher.mjs','utf8'),launch=await readFile('scripts/launch-local.mjs','utf8'),wrapper=await readFile('scripts/launch-local.py','utf8');
  assert.match(page,/href="apex-local:\/\/start"/);assert.doesNotMatch(page,/Start start-local.cmd/);
  assert.match(install,/HKCU/);assert.doesNotMatch(install,/HKLM|ExecutionPolicy|schtasks/i);
  assert.match(launch,/windowsHide:true/);assert.match(launch,/open\(lock,'wx'\)/);assert.doesNotMatch(launch,/shell:true|exec\(/);
  assert.match(install,/pythonw\.exe/);assert.match(wrapper,/CREATE_NO_WINDOW/);assert.doesNotMatch(wrapper,/shell=True|os\.system|exec\(/);
});
