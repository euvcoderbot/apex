import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {BACKEND_REVISION,SOURCE_REVISION} from '../lib/cache-revision.mjs';

const script=fileURLToPath(new URL('./prerender.mjs',import.meta.url));
async function fixture(revision=BACKEND_REVISION){
  const root=await mkdtemp(path.join(tmpdir(),'apex-prerender-test-'));
  const out=path.join(root,'assets/data/prerendered');
  const cache=path.join(root,'.apex-cache/dashboard-local-v2');
  await mkdir(out,{recursive:true});await mkdir(cache,{recursive:true});
  await writeFile(path.join(out,'index.json'),JSON.stringify({revision,sourceRevision:SOURCE_REVISION,entries:{'/api/session?old=1':'old.gz'},captures:{'/api/session?old=1':{captured_at:'2026-01-01'}}}));
  await writeFile(path.join(out,'old.gz'),'old snapshot');
  await writeFile(path.join(cache,'new.json'),JSON.stringify({key:`data:${BACKEND_REVISION}:/api/performance?gp=Test`,expires:Date.now()+30*86400000,data:{teams:[]}}));
  return {root,out};
}
test('prerender merges snapshots without clearing existing exports',async()=>{
  const {root,out}=await fixture();
  const run=spawnSync(process.execPath,[script],{cwd:root,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const manifest=JSON.parse(await readFile(path.join(out,'index.json'),'utf8'));
  assert.equal(manifest.entries['/api/session?old=1'],'old.gz');
  assert.equal(manifest.captures['/api/session?old=1'].captured_at,'2026-01-01');
  assert.ok(manifest.entries['/api/performance?gp=Test']);
  assert.equal(await readFile(path.join(out,'old.gz'),'utf8'),'old snapshot');
});
test('prerender refuses revision mismatches without changing existing files',async()=>{
  const {root,out}=await fixture('different');
  const before=await readFile(path.join(out,'index.json'),'utf8');
  const run=spawnSync(process.execPath,[script],{cwd:root,encoding:'utf8'});
  assert.notEqual(run.status,0);assert.match(run.stderr,/revisions differ/);
  assert.equal(await readFile(path.join(out,'index.json'),'utf8'),before);
  assert.equal(await readFile(path.join(out,'old.gz'),'utf8'),'old snapshot');
});

