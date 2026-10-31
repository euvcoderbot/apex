import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, readdir, rm, utimes, writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {plan, apply} from './sync-prepared-sessions.mjs';

const REV = {sourceRevision: 'src1', backendRevision: 'back1', measurementRevision: 'race1'};
const gz = value => gzipSync(JSON.stringify(value));

/** A release checkout holding captures {key: [file, capturedAt, body]} and lap packs {identity: [file, body]}. */
async function release(captures = {}, packs = {}, {revisions = REV, calendar = [{round: 1}]} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'apex-sync-'));
  const data = path.join(root, 'assets', 'data');
  await mkdir(path.join(root, 'lib'), {recursive: true});
  await writeFile(path.join(root, 'lib', 'cache-revision.mjs'),
    `export const SOURCE_REVISION = "${revisions.sourceRevision}";\nexport const BACKEND_REVISION = "${revisions.backendRevision}";\nexport const RACE_REVISION = "${revisions.measurementRevision}";\n`);
  for (const dir of ['local-captures', 'local-telemetry', 'events']) await mkdir(path.join(data, dir), {recursive: true});
  const entries = {}, packEntries = {};
  for (const [key, [file, capturedAt, body]] of Object.entries(captures)) {
    await writeFile(path.join(data, 'local-captures', file), gz(body)); entries[key] = {file, capturedAt};
  }
  for (const [identity, [file, body]] of Object.entries(packs)) { await writeFile(path.join(data, 'local-telemetry', file), gz(body)); packEntries[identity] = file; }
  await writeFile(path.join(data, 'local-captures', 'index.json'), JSON.stringify({schema: 'apex-local-captures-v1', ...revisions, generated: 'old', entries}));
  await writeFile(path.join(data, 'local-telemetry', 'index.json'), JSON.stringify({schema: 'native-lap-packs-v1', sourceRevision: revisions.sourceRevision, entries: packEntries}));
  await writeFile(path.join(data, 'events', '2026.json'), JSON.stringify(calendar));
  return {root, data, async cleanup() { await rm(root, {recursive: true, force: true}); }};
}
const index = async (r, dir) => JSON.parse(await readFile(path.join(r.data, dir, 'index.json'), 'utf8'));

test('a new session is added with its lap packs; nothing else changes', async () => {
  const site = await release({'/api/session?gp=A': ['aaaa.json.gz', '2026-10-28T00:00:00Z', {s: 'A'}]}, {'2026:A:Q:VER': ['p1.json.gz', {lap: 1}]});
  const prepared = await release({'/api/session?gp=A': ['aaaa.json.gz', '2026-10-28T00:00:00Z', {s: 'A'}], '/api/session?gp=B': ['bbbb.json.gz', '2026-10-31T01:00:00Z', {s: 'B'}]},
    {'2026:A:Q:VER': ['p1.json.gz', {lap: 1}], '2026:B:P1:VER': ['p2.json.gz', {lap: 2}]}, {calendar: [{round: 1}, {round: 2}]});
  const p = await plan(prepared.root, site.root);
  assert.deepEqual(p.captures.map(c => [c.action, c.key]), [['add', '/api/session?gp=B']]);
  assert.deepEqual(p.packs.map(c => [c.action, c.identity]), [['add', '2026:B:P1:VER']]);
  await apply(prepared.root, site.root, p);
  const captures = await index(site, 'local-captures'), packs = await index(site, 'local-telemetry');
  assert.deepEqual(Object.keys(captures.entries).sort(), ['/api/events?year=2026', '/api/session?gp=A', '/api/session?gp=B']);
  assert.equal(captures.sourceRevision, 'src1');
  assert.notEqual(captures.generated, 'old');
  assert.deepEqual(Object.keys(packs.entries).sort(), ['2026:A:Q:VER', '2026:B:P1:VER']);
  assert.ok((await readdir(path.join(site.data, 'local-telemetry'))).includes('p2.json.gz'));
  assert.equal(JSON.parse(await readFile(path.join(site.data, 'events', '2026.json'), 'utf8')).length, 2, 'the newer, fuller calendar is carried over');
  await Promise.all([site.cleanup(), prepared.cleanup()]);
});

test('a newer capture replaces an older one without deleting the superseded file; an older one never wins', async () => {
  const site = await release({'/api/x': ['old.json.gz', '2026-10-28T00:00:00Z', {v: 1}], '/api/y': ['y-new.json.gz', '2026-10-30T00:00:00Z', {v: 'site'}]});
  const prepared = await release({'/api/x': ['fresh.json.gz', '2026-10-29T00:00:00Z', {v: 2}], '/api/y': ['y-old.json.gz', '2026-10-27T00:00:00Z', {v: 'stale'}]});
  const p = await plan(prepared.root, site.root);
  assert.deepEqual(p.captures.map(c => [c.action, c.key]), [['replace', '/api/x']]);
  await apply(prepared.root, site.root, p);
  const files = await readdir(path.join(site.data, 'local-captures'));
  assert.ok(files.includes('fresh.json.gz') && files.includes('old.json.gz'), 'the replaced file is preserved');
  assert.ok(files.includes('y-new.json.gz'), 'the newer site capture stays');
  assert.equal((await index(site, 'local-captures')).entries['/api/y'].file, 'y-new.json.gz');
  await Promise.all([site.cleanup(), prepared.cleanup()]);
});

test('lap packs replace only when the prepared file differs and is newer', async () => {
  const site = await release({}, {'2026:A:Q:VER': ['p.json.gz', {lap: 1,local_export:{captured_at:'2026-10-30T00:00:00Z'}}], '2026:A:Q:NOR': ['n.json.gz', {lap: 1}]});
  const prepared = await release({}, {'2026:A:Q:VER': ['p.json.gz', {lap: 99,local_export:{captured_at:'2026-10-31T00:00:00Z'}}], '2026:A:Q:NOR': ['n.json.gz', {lap: 1}]});
  const later = new Date(Date.now() + 60_000);
  await utimes(path.join(prepared.data, 'local-telemetry', 'p.json.gz'), later, later);
  const p = await plan(prepared.root, site.root);
  assert.deepEqual(p.packs.map(c => [c.action, c.identity]), [['replace', '2026:A:Q:VER']], 'identical packs are left alone');
  await Promise.all([site.cleanup(), prepared.cleanup()]);
});

test('an older differently named telemetry pack cannot replace a newer capture',async()=>{
  const site=await release({}, {'2026:A:Q:VER':['new.json.gz',{local_export:{captured_at:'2026-11-01T00:00:00Z'},laps:{1:{samples:[1]}}}]});
  const prepared=await release({}, {'2026:A:Q:VER':['old.json.gz',{local_export:{captured_at:'2026-10-31T00:00:00Z'},laps:{1:{samples:[0]}}}]});
  try{
    await utimes(path.join(prepared.data,'local-telemetry/old.json.gz'),new Date(Date.now()+60000),new Date(Date.now()+60000));
    const p=await plan(prepared.root,site.root);
    assert.deepEqual(p.packs,[]);
    await apply(prepared.root,site.root,p);
    assert.equal((await index(site,'local-telemetry')).entries['2026:A:Q:VER'],'new.json.gz');
  }finally{await Promise.all([site.cleanup(),prepared.cleanup()]);}
});

test('prepared data built for other code revisions is refused', async () => {
  const site = await release();
  const prepared = await release({'/api/session?gp=B': ['b.json.gz', '2026-10-31T00:00:00Z', {}]}, {}, {revisions: {...REV, sourceRevision: 'other'}});
  const p = await plan(prepared.root, site.root);
  assert.match(p.problems[0], /would ignore them/);
  assert.equal(p.captures.length, 0);
  const result = (() => { try { execFileSync(process.execPath, ['scripts/sync-prepared-sessions.mjs', '--from', prepared.root, '--to', site.root, '--apply'], {stdio: 'pipe'}); return 0; } catch (e) { return e.status; } })();
  assert.equal(result, 1, 'the command exits non-zero and writes nothing');
  assert.deepEqual(Object.keys((await index(site, 'local-captures')).entries), []);
  await Promise.all([site.cleanup(), prepared.cleanup()]);
});

test('calendar completion is carried over even when the site checkout has a newer mtime', async () => {
  const site = await release({}, {}, {calendar: [{round: 1, name:'GP', session_statuses:{'Practice 1':'upcoming'}}]});
  const prepared = await release({}, {}, {calendar: [{round: 1, name:'GP', session_statuses:{'Practice 1':'completed'}}]});
  await utimes(path.join(site.data, 'events', '2026.json'), new Date(Date.now()+60_000), new Date(Date.now()+60_000));
  const p = await plan(prepared.root, site.root);
  assert.ok(p.calendar, 'completed session is not masked by checkout timestamps');
  await apply(prepared.root, site.root, p);
  assert.equal(JSON.parse(await readFile(path.join(site.data, 'events', '2026.json'), 'utf8'))[0].session_statuses['Practice 1'], 'completed');
  const entry=(await index(site, 'local-captures')).entries['/api/events?year=2026'];
  const captured=JSON.parse((await import('node:zlib')).gunzipSync(await readFile(path.join(site.data, 'local-captures',entry.file))).toString());
  assert.equal(captured[0].session_statuses['Practice 1'], 'completed');
  const reverse = await plan(site.root, prepared.root);
  assert.equal(reverse.calendar, null);
  await Promise.all([site.cleanup(), prepared.cleanup()]);
});

test('an unreadable snapshot file is never copied, and a dry run writes nothing', async () => {
  const site = await release();
  const prepared = await release({'/api/session?gp=B': ['bad.json.gz', '2026-10-31T00:00:00Z', {}]});
  await writeFile(path.join(prepared.data, 'local-captures', 'bad.json.gz'), 'not gzip');
  assert.match((await plan(prepared.root, site.root)).problems.join(), /unreadable capture file/);
  const good = await release({'/api/session?gp=C': ['c.json.gz', '2026-10-31T00:00:00Z', {}]});
  const dry = execFileSync(process.execPath, ['scripts/sync-prepared-sessions.mjs', '--from', good.root, '--to', site.root]).toString();
  assert.match(dry, /Dry run/);
  assert.deepEqual(await readdir(path.join(site.data, 'local-captures')), ['index.json'], 'nothing was written');
  await Promise.all([site.cleanup(), prepared.cleanup(), good.cleanup()]);
});

test('applying an unchanged sync leaves the index untouched', async () => {
  const site = await release();
  const prepared = await release();
  const before = await readFile(path.join(site.data, 'local-captures', 'index.json'), 'utf8');
  const output=execFileSync(process.execPath, ['scripts/sync-prepared-sessions.mjs', '--from', prepared.root, '--to', site.root, '--apply']).toString();
  assert.match(output, /Already up to date/);
  assert.equal(await readFile(path.join(site.data, 'local-captures', 'index.json'), 'utf8'),before);
  await Promise.all([site.cleanup(), prepared.cleanup()]);
});
