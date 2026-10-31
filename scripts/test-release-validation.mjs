import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {validateIndex,decodeSnapshot,validatePayload} from '../lib/release-validation.mjs';
test('release indexes fail closed for absent entries and future schemas',()=>{
  for(const index of [{},[],{entries:[]},{entries:{},schema:'future'}])assert.throws(()=>validateIndex(index,'local-captures'));
  validateIndex({entries:{},schema:'apex-local-captures-v1'},'local-captures');
});
test('readable gzip JSON is not sufficient evidence of a valid session',()=>{
  const value=decodeSnapshot(gzipSync('{}'));
  assert.throws(()=>validatePayload(value,'local-captures','/api/session?year=2026'),/drivers/);
  assert.throws(()=>validatePayload([], 'local-captures','/api/performance'),/teams/);
  assert.throws(()=>validatePayload({laps:{1:{}}},'telemetry'),/samples/);
  validatePayload({drivers:[],lap_data_complete:false},'local-captures','/api/session');
});
test('corrupt compression, invalid JSON and excessive expansion fail',()=>{
  assert.throws(()=>decodeSnapshot(Buffer.from('not gzip')));
  assert.throws(()=>decodeSnapshot(gzipSync('{invalid')));
  assert.throws(()=>decodeSnapshot(gzipSync('x'.repeat(10000)),{maximum:100}));
});
