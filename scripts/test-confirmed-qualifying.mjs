import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {confirmedQualifying} from '../lib/confirmed-qualifying.mjs';
import {captureKey} from '../lib/local-captures.mjs';

test('completion fallback requires an exact, settled, independently exported session', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'apex-completion-'));
  try {
    const folder = path.join(root, 'assets/data/local-captures');
    await mkdir(folder, {recursive:true});
    const event = {name:'British Grand Prix',round:9};
    const key = captureKey('/api/session?year=2026&gp=British+Grand+Prix&round=9&session=Qualifying');
    await writeFile(path.join(folder,'index.json'), JSON.stringify({entries:{[key]:{file:'abc123.json.gz'}}}));
    const payload = {event:event.name,session:'Qualifying',openf1_session_key:123,drivers:[{},{},{}],local_export:{session_key:123,source:'OpenF1 via local compute',provisional:false,session_ended_at:'2026-07-04T16:00:00Z'}};
    const save = () => writeFile(path.join(folder,'abc123.json.gz'),gzipSync(JSON.stringify(payload)));
    await save(); assert.equal(await confirmedQualifying(root,2026,event,Date.parse('2026-07-05')),true);
    payload.local_export.provisional=true; await save(); assert.equal(await confirmedQualifying(root,2026,event),false);
    payload.local_export.provisional=false; payload.openf1_session_key=456; await save(); assert.equal(await confirmedQualifying(root,2026,event),false);
    payload.openf1_session_key=123; payload.local_export.session_ended_at='2099-01-01T00:00:00Z'; await save(); assert.equal(await confirmedQualifying(root,2026,event),false);
    assert.equal(await confirmedQualifying(root,2026,{...event,round:8}),false);
  } finally { await rm(root,{recursive:true,force:true}); }
});
