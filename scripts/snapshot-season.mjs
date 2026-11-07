// Save the Season hub's data as static files the page reads before any API, so the hosted site (which has no
// backend for new data) and slow first loads both get it straight away: assets/data/season/<hash>.json.gz plus
// index.json, keyed by the API path the page asks for.
//
//   npm run local            # the local API (Python on :8001) must be running
//   npm run snapshot:season  # every season from 2018, or: node scripts/snapshot-season.mjs 2025 2026
//
// A finished season never changes, so its files are kept as they are; the current season is saved again on
// every run (after each race weekend). Pages show when the data they use was saved.
import {mkdir, readdir, readFile, unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {resolve} from 'node:path';
import {atomicBytes, atomicJson} from '../lib/atomic-json.mjs';

const root = process.cwd();
const outDir = resolve(root, 'assets', 'data', 'season');
const api = (process.env.APEX_SEASON_API || `http://127.0.0.1:${process.env.APEX_LOCAL_API_PORT || 8001}`).replace(/\/$/, '');
const current = new Date().getUTCFullYear();
const args = process.argv.slice(2).map(Number).filter(Number.isInteger);
const years = args.length ? args : Array.from({length: current - 2018 + 1}, (_, i) => current - i);
const refreshAll = process.argv.includes('--refresh');

// The FIA's car presentation and power-unit documents start in 2022.
const kinds = year => [['/api/season', data => data.rounds?.length > 0],
  // A finished season whose FIA documents include no upgrade submissions is saved as empty: that is the true answer.
  ...(year >= 2022 ? [['/api/season/upgrades', data => Array.isArray(data.items) && (data.items.length > 0 || year < current)],
    ['/api/season/power-units', data => data.rows?.length > 0]] : [])];

await mkdir(outDir, {recursive: true});
const index = await readFile(resolve(outDir, 'index.json'), 'utf8').then(JSON.parse).catch(() => ({entries: {}}));
const entries = {...index.entries};
let saved = 0, kept = 0, failed = 0;
for (const year of years) {
  for (const [path, usable] of kinds(year)) {
    const key = `${path}?year=${year}`;
    if (!refreshAll && year < current && entries[key]) { kept++; continue; }   // settled: keep the saved file
    try {
      const response = await fetch(api + key, {signal: AbortSignal.timeout(20 * 60_000)});
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || !usable(data)) throw new Error(data?.detail || `HTTP ${response.status}`);
      const body = gzipSync(JSON.stringify(data), {level: 9});
      const file = createHash('sha256').update(body).digest('hex').slice(0, 24) + '.json.gz';
      await atomicBytes(resolve(outDir, file), body);
      entries[key] = {file, saved_at: new Date().toISOString(), settled: year < current};
      saved++;
      console.log(`${key}: ${(body.length / 1024).toFixed(1)} KB`);
    } catch (error) {
      failed++;
      console.warn(`${key}: not saved (${error.message})`);
    }
  }
}
await atomicJson(resolve(outDir, 'index.json'), {generated: new Date().toISOString(), entries});
// Files no entry points to any more (an earlier save of the current season).
const used = new Set(Object.values(entries).map(e => e.file));
for (const name of await readdir(outDir)) if (name.endsWith('.json.gz') && !used.has(name)) await unlink(resolve(outDir, name));
console.log(JSON.stringify({saved, kept, failed, entries: Object.keys(entries).length}));
process.exitCode = failed && !saved && !kept ? 1 : 0;
