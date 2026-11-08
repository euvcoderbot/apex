import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {validateIndex,decodeSnapshot,validatePayload,validateSeasonIndex,validateSeasonPayload} from '../lib/release-validation.mjs';
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
test('season snapshot indexes name only season routes, well-formed files and save times',()=>{
  const entry={file:'0123456789abcdef01234567.json.gz',saved_at:'2026-11-07T14:12:37.390Z',settled:false};
  validateSeasonIndex({entries:{'/api/season?year=2026':entry,'/api/season/upgrades?year=2024':{...entry,settled:true},'/api/season/power-units?year=2022':entry}});
  for(const index of [{},{entries:[]},{entries:{'/api/session?year=2026':entry}},{entries:{'/api/season?year=2026&gp=x':entry}},
    {entries:{'/api/season?year=2026':{...entry,file:'../x.json.gz'}}},{entries:{'/api/season?year=2026':{...entry,saved_at:'never'}}},
    {entries:{'/api/season?year=2026':{file:entry.file,saved_at:entry.saved_at}}}])assert.throws(()=>validateSeasonIndex(index));
});
test('season snapshots must be complete and for the year they are filed under',()=>{
  const season={year:2026,rounds:[{round:1}],drivers:{},teams:{},standings:{},driver_stats:{}};
  validateSeasonPayload(season,'/api/season?year=2026');
  assert.throws(()=>validateSeasonPayload(season,'/api/season?year=2025'),/year/);
  assert.throws(()=>validateSeasonPayload({...season,rounds:[]},'/api/season?year=2026'),/rounds/);
  validateSeasonPayload({year:2023,items:[],events:[]},'/api/season/upgrades?year=2023');   // a season without upgrade documents
  assert.throws(()=>validateSeasonPayload({year:2023,events:[]},'/api/season/upgrades?year=2023'),/items/);
  validateSeasonPayload({year:2022,rows:[{number:'1'}],elements:['ICE']},'/api/season/power-units?year=2022');
  assert.throws(()=>validateSeasonPayload({year:2022,rows:[],elements:['ICE']},'/api/season/power-units?year=2022'),/rows/);
});
