import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {captureKey,mergeLocalCaptures} from '../lib/local-captures.mjs';

test('captured results merge by normalized identity and retain their actual timestamp',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'apex-capture-'));
  const revisions={sourceRevision:'s',backendRevision:'b',measurementRevision:'m'};
  const first={route:'/api/session?year=2026&gp=Test&session=Q&fresh=true',data:{drivers:[{code:'VER'}]},capturedAt:'2026-10-01T12:00:00Z'};
  const index=await mergeLocalCaptures(root,revisions,[first]);
  const key=captureKey(first.route),entry=index.entries[key];
  assert.equal(entry.capturedAt,first.capturedAt);
  assert.deepEqual(JSON.parse(gunzipSync(await readFile(path.join(root,'assets/data/local-captures',entry.file)))),first.data);
  const merged=await mergeLocalCaptures(root,revisions,[{route:'/api/qualifying-corners?year=2026&gp=Test&subject=team&refresh=1',data:{complete:false,traces:{VER:{}}}}]);
  assert.equal(Object.keys(merged.entries).length,2);assert.deepEqual(merged.entries[key],entry);
  await assert.rejects(mergeLocalCaptures(root,{...revisions,backendRevision:'other'},[]),/differs/);
  assert.equal(JSON.parse(await readFile(path.join(root,'assets/data/local-captures/index.json'),'utf8')).backendRevision,'b');
});
test('capture keys reject unrelated paths and discard refresh-only parameters',()=>{
  assert.equal(captureKey('/api/race-corners?year=2026&gp=Test&refresh=1'),'/api/race-corners?gp=Test&year=2026');
  assert.throws(()=>captureKey('/api/local-stop'),/Unsupported/);
});

