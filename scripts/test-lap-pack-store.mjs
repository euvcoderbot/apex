import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, writeFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {packRead, packWrite, servePack, acceptPack, REMOTE_FOLDERS} from '../lib/lap-pack-store.mjs';
import {copyPublishedAssets} from '../lib/published-assets.mjs';

const origin = 'https://site.test';
const bytesOf = text => new TextEncoder().encode(text);
const nameOf = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, 24) + '.json.gz';
const pack = bytesOf('{"laps":{"1":{"driver":"NOR"}}}'), packName = nameOf(pack);

function env({bundled = {}, index = {entries: {'2026:São Paulo Grand Prix:Race:NOR': packName}}} = {}) {
  const store = new Map();
  return {
    store,
    ASSETS: {async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/index.json')) return index ? Response.json(index) : new Response('', {status: 404});
      return bundled[url.pathname] ? new Response(bundled[url.pathname]) : new Response('not found', {status: 404});
    }},
    DATA_CACHE: {
      async get(key) { const value = store.get(key); return value ? {body: new Response(value).body, size: value.byteLength} : null; },
      async head(key) { return store.has(key) ? {} : null; },
      async put(key, value) { store.set(key, new Uint8Array(value)); },
    },
  };
}
const put = (target, body, e) => acceptPack(new Request(origin + '/api/lap-packs/' + target.folder + '/' + target.file, {method: 'PUT', body}), e, target, origin);

test('only exact pack paths in the remote folders are routed', () => {
  assert.deepEqual(packRead(`/apex/assets/data/local-telemetry/${packName}`), {folder: 'local-telemetry', file: packName, key: `lap-packs/local-telemetry/${packName}`});
  assert.equal(packRead('/apex/assets/data/local-captures/' + packName), null);
  assert.equal(packRead('/apex/assets/data/local-telemetry/index.json'), null);
  assert.equal(packRead('/apex/assets/data/local-telemetry/../server.py'), null);
  assert.equal(packWrite(`/api/lap-packs/telemetry/${packName}`).key, `lap-packs/telemetry/${packName}`);
  assert.equal(packWrite(`/api/lap-packs/prerendered/${packName}`), null);
  assert.deepEqual(REMOTE_FOLDERS, ['local-telemetry', 'telemetry']);
});

test('a published pack whose bytes match its name is stored once; anything else is refused', async () => {
  const e = env(), target = packWrite(`/api/lap-packs/local-telemetry/${packName}`);
  assert.equal((await put(target, pack, e)).status, 201);
  assert.deepEqual(e.store.get(target.key), pack);
  assert.equal((await put(target, pack, e)).status, 204, 'already stored');
  // Right name, wrong bytes.
  assert.equal((await put(target, bytesOf('{"laps":{}}'), env())).status, 422);
  // Correct bytes, but the deployed index does not list the pack.
  const other = bytesOf('{"other":true}'), otherTarget = packWrite(`/api/lap-packs/local-telemetry/${nameOf(other)}`);
  const refused = env();
  assert.equal((await put(otherTarget, other, refused)).status, 403);
  assert.equal(refused.store.size, 0);
  // Not a PUT, empty, no index, no bucket.
  assert.equal((await acceptPack(new Request(origin, {method: 'POST', body: pack}), env(), target, origin)).status, 405);
  assert.equal((await put(target, new Uint8Array(), env())).status, 413);
  assert.equal((await put(target, pack, env({index: null}))).status, 503);
  assert.equal((await put(target, pack, {...env(), DATA_CACHE: undefined})).status, 503);
});

test('packs are served from the package when bundled, otherwise from R2, otherwise 404', async () => {
  const target = packRead(`/apex/assets/data/local-telemetry/${packName}`);
  const request = () => new Request(`${origin}/apex/assets/data/local-telemetry/${packName}`);
  const bundled = env({bundled: {[`/apex/assets/data/local-telemetry/${packName}`]: 'from package'}});
  assert.equal(await (await servePack(request(), bundled, target)).text(), 'from package');
  const remote = env(); remote.store.set(target.key, pack);
  const served = await servePack(request(), remote, target);
  assert.equal(served.status, 200);
  assert.deepEqual(new Uint8Array(await served.arrayBuffer()), pack);
  assert.equal(served.headers.get('Content-Type'), 'application/json');
  assert.match(served.headers.get('Cache-Control'), /immutable/);
  assert.equal((await servePack(new Request(request(), {method: 'HEAD'}), remote, target)).status, 200);
  assert.equal((await servePack(request(), env(), target)).status, 404);
});

test('a remote-pack build ships each folder index but none of its packs', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'apex-packs-'));
  try {
    for (const folder of ['local-telemetry', 'local-captures']) {
      await mkdir(path.join(root, 'assets/data', folder), {recursive: true});
      await writeFile(path.join(root, 'assets/data', folder, 'index.json'), JSON.stringify({entries: {a: packName}}));
      await writeFile(path.join(root, 'assets/data', folder, packName), pack);
    }
    await copyPublishedAssets(path.join(root, 'assets'), path.join(root, 'out'), {remoteFolders: REMOTE_FOLDERS});
    assert.deepEqual(await readdir(path.join(root, 'out/data/local-telemetry')), ['index.json']);
    assert.deepEqual((await readdir(path.join(root, 'out/data/local-captures'))).sort(), [packName, 'index.json'].sort());
    await copyPublishedAssets(path.join(root, 'assets'), path.join(root, 'bundled'));
    assert.deepEqual((await readdir(path.join(root, 'bundled/data/local-telemetry'))).sort(), [packName, 'index.json'].sort());
  } finally { await rm(root, {recursive: true, force: true}); }
});
