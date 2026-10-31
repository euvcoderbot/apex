import test from 'node:test';
import assert from 'node:assert/strict';
import {dataErrorResponse} from '../lib/http-errors.mjs';
import {publicDataResponse} from '../lib/http-data.mjs';
test('unexpected web failures are opaque and correlate to a structured request ID',async()=>{
  const logs=[],response=dataErrorResponse(new Error('secret /internal/path token=abc'),line=>logs.push(JSON.parse(line)));
  const body=await response.json();
  assert.equal(response.status,502);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(body.request_id,response.headers.get('x-request-id'));assert.equal(logs[0].request_id,body.request_id);
  assert.doesNotMatch(JSON.stringify({body,logs}),/secret|internal|token=abc/);
});
test('deliberate public status errors keep actionable messages and timeout status',async()=>{
  const response=dataErrorResponse(Object.assign(Error('Result not published yet'),{status:503}),()=>{});
  assert.equal(response.status,503);assert.equal((await response.json()).detail,'Result not published yet');
  assert.equal(dataErrorResponse({name:'TimeoutError'},()=>{}).status,504);
  assert.equal(dataErrorResponse(null,()=>{}).status,502);
});
test('manual refresh, POST queries and superseded results are never HTTP cached',()=>{
  const result={data:{},cache:'MISS',ttl:3600};
  assert.match(publicDataResponse(result).headers.get('cache-control'),/public/);
  assert.equal(publicDataResponse(result,{fresh:true}).headers.get('cache-control'),'no-store');
  assert.equal(publicDataResponse({...result,ttl:0}).headers.get('cache-control'),'no-store');
});
