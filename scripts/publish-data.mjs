// Publish this checkout's prepared data to the live Site's R2 bucket (lib/data-store.mjs), without a redeploy.
//
//   node scripts/publish-data.mjs                 # check, then upload what the Site lacks
//   node scripts/publish-data.mjs --dry-run       # report what would be uploaded
//   node scripts/publish-data.mjs --site http://127.0.0.1:8787 --skip-check
//   node scripts/publish-data.mjs --init-key      # once: create the signing key (private half stays on this PC)
//
// Order: content-addressed files first (only those the Site does not already serve), then the indexes and calendars,
// so a published index never refers to a missing file. Every upload is signed with the private key in
// %USERPROFILE%\apex-data\publish-key.json (override with APEX_PUBLISH_KEY); the Site verifies it with the public key in
// lib/publish-key.mjs. Runs `npm run release:check` first unless --skip-check.
import {readFile, readdir, writeFile, mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash, webcrypto} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DATA_FOLDERS, signedMessage} from '../lib/data-store.mjs';

const {subtle} = webcrypto;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), flag = name => args.includes(name), value = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const keyFile = process.env.APEX_PUBLISH_KEY || path.join(os.homedir(), 'apex-data', 'publish-key.json');
const b64 = bytes => Buffer.from(bytes).toString('base64');

if (flag('--init-key')) {
  if (existsSync(keyFile)) throw new Error(`A key already exists at ${keyFile}; refusing to replace it.`);
  const pair = await subtle.generateKey({name: 'Ed25519'}, true, ['sign', 'verify']);
  await mkdir(path.dirname(keyFile), {recursive: true});
  await writeFile(keyFile, JSON.stringify({created: new Date().toISOString(), privateKey: await subtle.exportKey('jwk', pair.privateKey)}), {mode: 0o600});
  console.log(`Private key saved to ${keyFile} (keep it on this PC; never commit it).`);
  console.log(`Public key for lib/publish-key.mjs: ${b64(await subtle.exportKey('raw', pair.publicKey))}`);
  process.exit(0);
}

const site = (value('--site') || 'https://f1apexdata.eufrandota14.chatgpt.site').replace(/\/$/, '');
if (!/^https:\/\/|^http:\/\/127\.0\.0\.1(:\d+)?$/.test(site)) throw new Error('--site must be an https origin (or http://127.0.0.1 for a local test)');
const dryRun = flag('--dry-run');
if (!flag('--skip-check')) {
  const check = spawnSync(process.execPath, [path.join(root, 'scripts/check-release.mjs')], {cwd: root, stdio: 'inherit'});
  if (check.status !== 0) throw new Error('release:check failed; nothing was published');
}
const {privateKey: jwk} = JSON.parse(await readFile(keyFile, 'utf8').catch(() => { throw new Error(`No signing key at ${keyFile}; run with --init-key first`); }));
const privateKey = await subtle.importKey('jwk', jwk, {name: 'Ed25519'}, false, ['sign']);

// What to publish: every file each folder's index names, plus the index; events/ is the calendars themselves.
const data = path.join(root, 'assets/data');
const immutable = [], mutable = [];
for (const folder of DATA_FOLDERS) {
  const dir = path.join(data, folder);
  if (!existsSync(dir)) continue;
  if (folder === 'events') { for (const file of (await readdir(dir)).filter(f => /^\d{4}\.json$/.test(f))) mutable.push({folder, file}); continue; }
  if (!existsSync(path.join(dir, 'index.json'))) continue;
  const index = JSON.parse(await readFile(path.join(dir, 'index.json'), 'utf8'));
  for (const file of new Set(Object.values(index.entries || index).map(e => (typeof e === 'string' ? e : e?.file)).filter(Boolean))) immutable.push({folder, file});
  mutable.push({folder, file: 'index.json'});
}

const counts = {present: 0, uploaded: 0, unchanged: 0, failed: 0};
const failures = [];
async function upload({folder, file}) {
  const body = await readFile(path.join(data, folder, file));
  const signedAt = new Date().toISOString(), hash = createHash('sha256').update(body).digest('hex');
  const signature = b64(await subtle.sign({name: 'Ed25519'}, privateKey, new TextEncoder().encode(signedMessage(folder, file, hash, signedAt))));
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(`${site}/api/publish/${folder}/${file}`, {method: 'PUT', body,
      headers: {'Content-Type': 'application/octet-stream', 'X-Apex-Signed-At': signedAt, 'X-Apex-Signature': signature}}).catch(error => ({ok: false, status: 0, error}));
    if (response.ok) return true;
    if (attempt === 3 || (response.status >= 400 && response.status < 500)) { failures.push(`${folder}/${file}: ${response.status}`); return false; }
    await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
  }
  return false;
}
async function pool(items, work, size = 6) {
  let next = 0;
  await Promise.all(Array.from({length: size}, async () => { while (next < items.length) await work(items[next++]); }));
}

// 1. Content-addressed files the Site does not yet serve (never re-sent: their name is their content).
await pool(immutable, async item => {
  const head = await fetch(`${site}/apex/assets/data/${item.folder}/${item.file}`, {method: 'HEAD'}).catch(() => null);
  if (head?.ok) { counts.present++; return; }
  if (dryRun) { counts.uploaded++; return; }
  (await upload(item)) ? counts.uploaded++ : counts.failed++;
  const done = counts.present + counts.uploaded + counts.failed;
  if (done % 200 === 0) console.log(`  ${done}/${immutable.length}`);
});
// 2. Indexes and calendars, only when different from what is live, and only if every file above is in place.
if (counts.failed) throw new Error(`${counts.failed} file uploads failed; indexes were not updated. ${failures.slice(0, 5).join('; ')}`);
for (const item of mutable) {
  const local = await readFile(path.join(data, item.folder, item.file));
  const live = await fetch(`${site}/apex/assets/data/${item.folder}/${item.file}`, {cache: 'no-store'}).then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
  if (live && Buffer.from(live).equals(local)) { counts.unchanged++; continue; }
  if (dryRun) { counts.uploaded++; continue; }
  (await upload(item)) ? counts.uploaded++ : counts.failed++;
}
console.log(JSON.stringify({site, files: immutable.length, indexes: mutable.length, ...counts, dryRun, failures: failures.slice(0, 10)}));
if (counts.failed) process.exitCode = 1;
