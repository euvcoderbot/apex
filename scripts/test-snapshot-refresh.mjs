import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

test('snapshot invalidation drops old manifest and pack promises and advances cache namespace',()=>{
  const source=readFileSync('session-state.js','utf8');
  const start=source.indexOf('let prerenderedIndex = null;');
  const end=source.indexOf('async function readSavedJson',start);
  const context=vm.createContext({Date,Map});
  vm.runInContext(source.slice(start,end),context);
  vm.runInContext("localCaptureIndex=Promise.resolve({old:true});nativeTelemetryPacks.set('old',{});invalidateSnapshotData(123)",context);
  assert.equal(vm.runInContext('localCaptureIndex',context),null);
  assert.equal(vm.runInContext('nativeTelemetryPacks.size',context),0);
  assert.equal(vm.runInContext('snapshotGeneration',context),1);
  assert.equal(vm.runInContext('snapshotCheckedAt',context),123);
});
