import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import '../analysis-core.js';
import {atomicJson,captureLock} from '../lib/atomic-json.mjs';
import {mergeLocalCaptures} from '../lib/local-captures.mjs';
import {limitedJson} from '../lib/request-json.ts';
import {snapshotCompatible} from '../lib/snapshot-policy.mjs';

test('web batch body limits apply before JSON parsing, including streaming requests',async()=>{
  const request=text=>new Request('http://test',{method:'POST',body:text});
  assert.deepEqual(await limitedJson(request('{"path":"ok"}'),20),{path:'ok'});
  await assert.rejects(limitedJson(request('x'.repeat(21)),20),e=>e.status===413);
  await assert.rejects(limitedJson(request('not json')),e=>e.status===400);
});

test('snapshot allowances apply only to specifically audited current revisions',()=>{
  assert.ok(snapshotCompatible('backendRevision','1af2a5e364d242f1b28d','71adaa62766be3dbf91d'));
  assert.equal(snapshotCompatible('backendRevision','1af2a5e364d242f1b28d','future-model'),false);
});

test('metric coverage does not count successful race results as qualifying telemetry',()=>{
  const events=[{Q:{teams:[{}]},speedDomain:{team:{cars:{VER:{}}}}},{R:{teams:[{}]}},{Q:{teams:[{}]}}];
  assert.equal(globalThis.ApexAnalysis.metricCoverage(events,'corners'),1);
  assert.equal(globalThis.ApexAnalysis.metricCoverage(events,'trend'),2);
  assert.equal(globalThis.ApexAnalysis.metricCoverage(events,'results'),1);
  assert.equal(globalThis.ApexAnalysis.metricCoverage(events,'pace'),3);
});

test('capture writers share an exclusive lock and failed writes retain the last complete index',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'apex-atomic-'));
  try {
    const target=path.join(root,'index.json');await atomicJson(target,{version:1});
    await assert.rejects(atomicJson(target,{bad:1n}));
    assert.deepEqual(JSON.parse(await readFile(target)),{version:1});
    await captureLock(root,async()=>{
      await assert.rejects(captureLock(root,async()=>{}),/Another capture/);
      await assert.rejects(mergeLocalCaptures(root,{},[]),/Another capture/);
    });
    await captureLock(root,async()=>{});
  }finally{await rm(root,{recursive:true,force:true});}
});

test('an older captured observation never replaces newer data',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'apex-order-'));
  const revisions={sourceRevision:'s',backendRevision:'b',measurementRevision:'m'};
  try{
    const route='/api/session?year=2026&gp=Test';
    await mergeLocalCaptures(root,revisions,[{route,data:{new:true},capturedAt:'2026-10-31T00:00:00Z'}]);
    const filename=path.join(root,'assets/data/local-captures/index.json');
    const before=JSON.parse(await readFile(filename));
    const after=await mergeLocalCaptures(root,revisions,[{route,data:{old:true},capturedAt:'2026-10-30T00:00:00Z'}]);
    assert.deepEqual(after.entries,before.entries);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('approved snapshot migration retains each older result revision',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'apex-provenance-'));
  const before={sourceRevision:'5b02cc1bb2a6daf808ad',backendRevision:'1af2a5e364d242f1b28d',measurementRevision:'8c25fd64c88df6373166'};
  const after={...before,backendRevision:'71adaa62766be3dbf91d',measurementRevision:'267fe2622a3941ad629a'};
  try{
    await mergeLocalCaptures(root,before,[{route:'/api/performance?year=2026&gp=Test',data:{teams:[]}}]);
    const index=await mergeLocalCaptures(root,after,[{route:'/api/session?year=2026&gp=Test',data:{drivers:[]}}]);
    assert.equal(index.backendRevision,after.backendRevision);
    assert.equal(index.entries['/api/performance?gp=Test&year=2026'].backendRevision,before.backendRevision);
    assert.equal(index.entries['/api/session?gp=Test&year=2026'].backendRevision,after.backendRevision);
  }finally{await rm(root,{recursive:true,force:true});}
});
