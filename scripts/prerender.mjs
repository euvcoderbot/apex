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
import {readdir, readFile, writeFile, mkdir, rename} from 'node:fs/promises';
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

const previous = await readFile(resolve(outDir,'index.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
if(previous&&(previous.revision!==BACKEND_REVISION||previous.sourceRevision!==SOURCE_REVISION))
  throw new Error('Existing snapshot revisions differ; no existing exports were removed.');
const entries={...previous?.entries},expires={...previous?.expires};
let bytes = 0;
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
  entries[path] = file; expires[path]=item.expires; bytes += body.length;
}
const temp=resolve(outDir,'index.json.tmp');
await writeFile(temp,JSON.stringify({...previous,revision:BACKEND_REVISION,sourceRevision:SOURCE_REVISION,generated:new Date().toISOString(),entries,expires}));
await rename(temp,resolve(outDir,'index.json'));
console.log(JSON.stringify({revision: BACKEND_REVISION, sourceRevision: SOURCE_REVISION, files: Object.keys(entries).length, megabytes: +(bytes / 1e6).toFixed(2)}));
