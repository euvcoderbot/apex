// Pre-render settled car-performance data into static files the page reads
// before calling the API (like a static site), for both the local and the
// hosted build: assets/data/prerendered/<hash>.json.gz plus index.json.
//
//   npm run local:warm      # compute the season with the current methodology
//   npm run prerender       # export what is settled
//
// Only entries computed with the current methodology (BACKEND_REVISION) and
// marked settled by the cache's own expiry policy are exported; the page uses
// the manifest only when its revision matches the page's, so a methodology
// change can never serve stale numbers. Live or recent sessions keep loading
// on demand.
import {readdir, readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {resolve} from 'node:path';
import {BACKEND_REVISION} from '../lib/cache-revision.mjs';

const root = process.cwd();
const cacheDir = resolve(root, '.apex-cache', 'dashboard');
const outDir = resolve(root, 'assets', 'data', 'prerendered');
const PATHS = ['/api/performance', '/api/performance/trace-batch', '/api/performance/pits', '/api/performance/sprint'];
const SETTLED_MS = 7 * 86400000;   // the cache gives settled sessions a long expiry
const prefix = 'data:' + BACKEND_REVISION + ':';

const entries = {};
let bytes = 0;
await rm(outDir, {recursive: true, force: true});
await mkdir(outDir, {recursive: true});
for (const name of await readdir(cacheDir).catch(() => [])) {
  if (!name.endsWith('.json')) continue;
  let item;
  try { item = JSON.parse(await readFile(resolve(cacheDir, name), 'utf8')); } catch { continue; }
  if (!item?.key?.startsWith(prefix) || !(item.expires > Date.now() + SETTLED_MS)) continue;
  const path = item.key.slice(prefix.length);
  if (!PATHS.includes(path.split('?')[0])) continue;
  const body = gzipSync(JSON.stringify(item.data), {level: 9});
  const file = createHash('sha256').update(path).digest('hex').slice(0, 24) + '.json.gz';
  await writeFile(resolve(outDir, file), body);
  entries[path] = file; bytes += body.length;
}
await writeFile(resolve(outDir, 'index.json'), JSON.stringify({revision: BACKEND_REVISION, generated: new Date().toISOString(), entries}, null, 0));
console.log(JSON.stringify({revision: BACKEND_REVISION, files: Object.keys(entries).length, megabytes: +(bytes / 1e6).toFixed(2)}));
