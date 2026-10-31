import test from 'node:test';
import assert from 'node:assert/strict';
import {limitedJson} from '../lib/request-json.ts';
test('web body parsing enforces depth, compression and read deadlines',async()=>{
  const request=body=>new Request('http://test',{method:'POST',body});
  await assert.rejects(limitedJson(request('['.repeat(65)+'0'+']'.repeat(65))),error=>error.status===400);
  assert.equal(await limitedJson(request(JSON.stringify('['.repeat(80)))),'['.repeat(80));
  await assert.rejects(limitedJson(new Request('http://test',{method:'POST',body:'x',headers:{'content-encoding':'gzip'}})),error=>error.status===415);
  const stream=new ReadableStream({pull(){return new Promise(()=>{});}});
  const input=new Request('http://test',{method:'POST',body:stream,duplex:'half'});
  await assert.rejects(limitedJson(input,1000,10),error=>error.status===408);
});
