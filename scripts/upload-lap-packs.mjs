// Upload lap-telemetry packs to the Site's R2 bucket through the deployed Site itself (lib/lap-pack-store.mjs).
//
//   node scripts/upload-lap-packs.mjs [--site https://f1apexdata.eufrandota14.chatgpt.site] [--dry-run]
//
// Run it after deploying a build made with APEX_LAP_PACKS=r2. For every pack named by this checkout's local-telemetry
// and telemetry indexes, it asks the Site whether the pack is already served; missing packs are uploaded. The Site
// stores a pack only if the deployed index lists it and the bytes hash to its name, so this cannot publish anything
// the deployment does not already reference. Safe to re-run: present packs are skipped.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {REMOTE_FOLDERS} from '../lib/lap-pack-store.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const site = (args.includes('--site') ? args[args.indexOf('--site') + 1] : 'https://f1apexdata.eufrandota14.chatgpt.site').replace(/\/$/, '');
const dryRun = args.includes('--dry-run');
// https only; plain http is allowed for a local test server (wrangler dev) on this PC.
if (!/^https:\/\/|^http:\/\/127\.0\.0\.1(:\d+)?$/.test(site)) throw new Error('--site must be an https origin');

const jobs = [];
for (const folder of REMOTE_FOLDERS) {
  const index = JSON.parse(await readFile(path.join(root, 'assets/data', folder, 'index.json'), 'utf8'));
  // The deployed index must be the same one, or the Site would refuse these packs.
  const deployed = await fetch(`${site}/apex/assets/data/${folder}/index.json`, {cache: 'no-store'}).then(r => (r.ok ? r.json() : null));
  if (!deployed || deployed.sourceRevision !== index.sourceRevision)
    throw new Error(`${folder}: the deployed index (${deployed?.sourceRevision || 'missing'}) differs from this checkout (${index.sourceRevision}); deploy first`);
  for (const entry of new Set(Object.values(index.entries).map(e => (typeof e === 'string' ? e : e.file)))) jobs.push({folder, file: entry});
}

const counts = {present: 0, uploaded: 0, failed: 0};
const failures = [];
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const {folder, file} = jobs[next++];
    const head = await fetch(`${site}/apex/assets/data/${folder}/${file}`, {method: 'HEAD'}).catch(() => null);
    if (head?.ok) { counts.present++; continue; }
    if (dryRun) { counts.uploaded++; continue; }
    const body = await readFile(path.join(root, 'assets/data', folder, file));
    for (let attempt = 1; attempt <= 3; attempt++) {
      const put = await fetch(`${site}/api/lap-packs/${folder}/${file}`, {method: 'PUT', body, headers: {'Content-Type': 'application/octet-stream'}}).catch(error => ({ok: false, status: 0, error}));
      if (put.ok) { counts.uploaded++; break; }
      if (attempt === 3 || (put.status >= 400 && put.status < 500)) { counts.failed++; failures.push(`${folder}/${file}: ${put.status}`); break; }
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
    if ((counts.uploaded + counts.present + counts.failed) % 100 === 0) console.log(`  ${counts.uploaded + counts.present + counts.failed}/${jobs.length}`);
  }
}
await Promise.all(Array.from({length: 6}, worker));
console.log(JSON.stringify({site, packs: jobs.length, ...counts, dryRun, failures: failures.slice(0, 10)}));
if (counts.failed) process.exitCode = 1;
