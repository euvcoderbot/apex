// Pre-render settled car-performance data into static files the page reads
// before calling the API (like a static site), for both the local and the
// hosted build: assets/data/prerendered/<hash>.json.gz plus index.json.
//
//   npm run local:warm      # compute the season with the current methodology
//   npm run prerender       # export what is settled
//
// Only entries computed with the current revisions (BACKEND_REVISION for car
// performance, SOURCE_REVISION for session summaries) and marked settled by
// the cache's own expiry policy are exported; the page uses an entry only when
// its family's revision matches the page's, so a methodology change can never
// serve stale numbers. Live or recent sessions keep loading on demand.
import {readdir, readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {resolve} from 'node:path';
import {BACKEND_REVISION,SOURCE_REVISION} from '../lib/cache-revision.mjs';

const root = process.cwd();
// The local server's cache (scripts/start-local.mjs cacheRoot).
const cacheDir = resolve(root, '.apex-cache', 'dashboard-local-v2');
const outDir = resolve(root, 'assets', 'data', 'prerendered');
const FAMILIES = {
  ['data:' + BACKEND_REVISION + ':']: ['/api/performance', '/api/performance/trace-batch', '/api/performance/pits', '/api/performance/sprint'],
  ['source:' + SOURCE_REVISION + ':']: ['/api/session'],
};
const SETTLED_MS = 7 * 86400000;   // the cache gives settled sessions a long expiry

const entries = {};
let bytes = 0;
// Sessions captured by scripts/export-local-session.py (practice included)
// are not in the dashboard cache: keep them while the source revision holds.
const previous = await readFile(resolve(outDir, 'index.json'), 'utf8').then(JSON.parse).catch(() => null);
const kept = [];
if (previous?.sourceRevision === SOURCE_REVISION) {
  for (const [path, capture] of Object.entries(previous.captures || {})) {
    const file = previous.entries?.[path];
    const body = file && await readFile(resolve(outDir, file)).catch(() => null);
    if (body) kept.push({path, file, body, capture});
  }
}
await rm(outDir, {recursive: true, force: true});
await mkdir(outDir, {recursive: true});
for (const name of await readdir(cacheDir).catch(() => [])) {
  if (!name.endsWith('.json')) continue;
  let item;
  try { item = JSON.parse(await readFile(resolve(cacheDir, name), 'utf8')); } catch { continue; }
  const prefix = Object.keys(FAMILIES).find(p => item?.key?.startsWith(p));
  if (!prefix || !(item.expires > Date.now() + SETTLED_MS)) continue;
  const path = item.key.slice(prefix.length);
  if (!FAMILIES[prefix].includes(path.split('?')[0])) continue;
  const body = gzipSync(JSON.stringify(item.data), {level: 9});
  const file = createHash('sha256').update(path).digest('hex').slice(0, 24) + '.json.gz';
  await writeFile(resolve(outDir, file), body);
  entries[path] = file; bytes += body.length;
}
const captures = {};
for (const {path, file, body, capture} of kept) {
  if (entries[path]) continue;
  await writeFile(resolve(outDir, file), body);
  entries[path] = file; captures[path] = capture; bytes += body.length;
}
await writeFile(resolve(outDir, 'index.json'), JSON.stringify({revision: BACKEND_REVISION, sourceRevision: SOURCE_REVISION, generated: new Date().toISOString(), entries,
  ...(Object.keys(captures).length ? {captures} : {})}, null, 0));
console.log(JSON.stringify({revision: BACKEND_REVISION, sourceRevision: SOURCE_REVISION, files: Object.keys(entries).length, megabytes: +(bytes / 1e6).toFixed(2)}));
