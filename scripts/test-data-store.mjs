import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, webcrypto} from 'node:crypto';
import {mkdtemp, mkdir, writeFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {dataRead, dataWrite, serveData, acceptPublish, signedMessage, DATA_FOLDERS} from '../lib/data-store.mjs';
import {copyPublishedAssets} from '../lib/published-assets.mjs';
import {PUBLISH_PUBLIC_KEY} from '../lib/publish-key.mjs';

const {subtle} = webcrypto;
const b64 = bytes => Buffer.from(bytes).toString('base64');
const enc = text => new TextEncoder().encode(text);
const hashName = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, 24) + '.json.gz';
// A throwaway key pair: tests never touch the real publishing key.
const pair = await subtle.generateKey({name: 'Ed25519'}, true, ['sign', 'verify']);
const publicKey = b64(await subtle.exportKey('raw', pair.publicKey));
const NOW = Date.parse('2026-11-09T12:00:00Z');

async function signedPut(folder, file, body, {signedAt = new Date(NOW).toISOString(), key = pair.privateKey, signFile = file} = {}) {
  const hash = createHash('sha256').update(body).digest('hex');
  const signature = b64(await subtle.sign({name: 'Ed25519'}, key, enc(signedMessage(folder, signFile, hash, signedAt))));
  return new Request(`https://site.test/api/publish/${folder}/${file}`, {method: 'PUT', body, headers: {'X-Apex-Signed-At': signedAt, 'X-Apex-Signature': signature}});
}
function env({bundled = {}} = {}) {
  const store = new Map();
  return {
    store,
    ASSETS: {async fetch(request) { const p = new URL(request.url).pathname; return bundled[p] ? new Response(bundled[p]) : new Response('not found', {status: 404}); }},
    DATA_CACHE: {
      async get(key) { const v = store.get(key); return v ? {body: new Response(v.bytes).body, size: v.bytes.byteLength, httpEtag: `"${v.meta.sha256}"`} : null; },
      async head(key) { const v = store.get(key); return v ? {customMetadata: v.meta} : null; },
      async put(key, bytes, options) { store.set(key, {bytes: new Uint8Array(bytes), meta: options.customMetadata}); },
    },
  };
}
const publish = (request, e, opts = {}) => acceptPublish(request, e, dataWrite(new URL(request.url).pathname), {now: NOW, publicKey, ...opts});

test('the real public key is configured, and only data paths are routed', () => {
  assert.equal(Buffer.from(PUBLISH_PUBLIC_KEY, 'base64').length, 32);
  assert.deepEqual(DATA_FOLDERS, ['local-captures', 'prerendered', 'sessions', 'local-telemetry', 'telemetry', 'season', 'events']);
  const pack = dataRead('/apex/assets/data/local-telemetry/0123456789abcdef01234567.json.gz');
  assert.equal(pack.key, 'data/local-telemetry/0123456789abcdef01234567.json.gz'); assert.equal(pack.hashed, true); assert.equal(pack.mutable, false);
  assert.equal(dataRead('/apex/assets/data/events/2026.json').mutable, true);
  assert.equal(dataRead('/apex/assets/data/season/index.json').mutable, true);
  for (const bad of ['/apex/assets/data/local-captures/../server.py', '/apex/assets/data/flags/gb.svg', '/apex/assets/data/season/notes.txt', '/apex/assets/drivers/albon.webp'])
    assert.equal(dataRead(bad), null, bad);
  assert.equal(dataWrite('/api/publish/prerendered/index.json').folder, 'prerendered');
  assert.equal(dataWrite('/api/publish/assets/x.json'), null);
});

test('signed uploads are stored; unsigned, forged, stale or mismatched ones are refused', async () => {
  const e = env(), body = enc('{"laps":{}}'), name = hashName(body);
  assert.equal((await publish(await signedPut('local-telemetry', name, body), e)).status, 201);
  assert.equal((await publish(await signedPut('local-telemetry', name, body), e)).status, 204, 'already there');
  // Unsigned.
  assert.equal((await publish(new Request(`https://site.test/api/publish/local-telemetry/${name}`, {method: 'PUT', body}), env())).status, 401);
  // Signed by another key.
  const other = await subtle.generateKey({name: 'Ed25519'}, true, ['sign', 'verify']);
  assert.equal((await publish(await signedPut('local-telemetry', name, body, {key: other.privateKey}), env())).status, 403);
  // A signature for another path cannot be reused here.
  assert.equal((await publish(await signedPut('prerendered', 'index.json', body, {signFile: 'other.json'}), env())).status, 403);
  // Expired or from the future.
  assert.equal((await publish(await signedPut('local-telemetry', name, body, {signedAt: new Date(NOW - 25 * 3600e3).toISOString()}), env())).status, 401);
  assert.equal((await publish(await signedPut('local-telemetry', name, body, {signedAt: new Date(NOW + 3600e3).toISOString()}), env())).status, 401);
  // Correctly signed, but the bytes do not match a content-addressed name.
  assert.equal((await publish(await signedPut('local-telemetry', '0123456789abcdef01234567.json.gz', body), env())).status, 422);
  // Publishing not configured.
  assert.equal((await publish(await signedPut('local-telemetry', name, body), env(), {publicKey: ''})).status, 503);
  assert.equal((await acceptPublish(new Request('https://site.test/api/publish/season/index.json'), env(), dataWrite('/api/publish/season/index.json'), {now: NOW, publicKey})).status, 405);
});

test('an index can be replaced by a newer signed copy, never by an older one', async () => {
  const e = env(), v1 = enc('{"entries":{"a":"1"}}'), v2 = enc('{"entries":{"a":"2"}}');
  const at = offset => new Date(NOW + offset).toISOString();
  assert.equal((await publish(await signedPut('season', 'index.json', v1, {signedAt: at(-60e3)}), e)).status, 201);
  assert.equal((await publish(await signedPut('season', 'index.json', v2, {signedAt: at(0)}), e)).status, 201);
  assert.equal((await publish(await signedPut('season', 'index.json', v1, {signedAt: at(-30e3)}), e)).status, 409, 'replaying an older publish');
  assert.deepEqual(e.store.get('data/season/index.json').bytes, v2);
});

test('changing files come from R2 first; content-addressed files from the package, then R2', async () => {
  const index = '/apex/assets/data/prerendered/index.json', packPath = '/apex/assets/data/telemetry/0123456789abcdef01234567.json.gz';
  const e = env({bundled: {[index]: 'bundled index', [packPath]: 'bundled pack'}});
  e.store.set('data/prerendered/index.json', {bytes: enc('published index'), meta: {sha256: 'abc'}});
  const served = await serveData(new Request('https://site.test' + index), e, dataRead(index));
  assert.equal(await served.text(), 'published index');
  assert.equal(served.headers.get('Cache-Control'), 'public, max-age=0, must-revalidate');
  assert.equal((await serveData(new Request('https://site.test' + index, {headers: {'If-None-Match': '"abc"'}}), e, dataRead(index))).status, 304);
  assert.equal(await (await serveData(new Request('https://site.test' + packPath), e, dataRead(packPath))).text(), 'bundled pack');
  const remote = env(); remote.store.set('data/telemetry/0123456789abcdef01234567.json.gz', {bytes: enc('r2 pack'), meta: {sha256: 'def'}});
  const pack = await serveData(new Request('https://site.test' + packPath), remote, dataRead(packPath));
  assert.equal(await pack.text(), 'r2 pack'); assert.match(pack.headers.get('Cache-Control'), /immutable/);
  assert.equal((await serveData(new Request('https://site.test' + packPath), env(), dataRead(packPath))).status, 404);
  // Nothing published and nothing bundled: the package's own answer.
  assert.equal(await (await serveData(new Request('https://site.test' + index), env({bundled: {[index]: 'bundled index'}}), dataRead(index))).text(), 'bundled index');
});

test('an R2 build ships no published data at all', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'apex-data-'));
  try {
    for (const folder of ['local-captures', 'events', 'flags']) {
      await mkdir(path.join(root, 'assets/data', folder), {recursive: true});
      await writeFile(path.join(root, 'assets/data', folder, 'index.json'), '{"entries":{}}');
    }
    await copyPublishedAssets(path.join(root, 'assets'), path.join(root, 'out'), {remoteFolders: DATA_FOLDERS});
    assert.deepEqual(await readdir(path.join(root, 'out/data')), ['flags']);
  } finally { await rm(root, {recursive: true, force: true}); }
});
