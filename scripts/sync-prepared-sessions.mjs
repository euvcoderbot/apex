// Carry locally prepared sessions into the folder the public Site is published from.
//
//   node scripts/sync-prepared-sessions.mjs --from <preparing checkout> --to <site checkout>          dry run
//   node scripts/sync-prepared-sessions.mjs --from <preparing checkout> --to <site checkout> --apply
//
// Session archiving prepares each finished session in the checkout it runs from:
// native lap packs in assets/data/local-telemetry, session and car-performance
// snapshots in assets/data/local-captures, and the calendar in assets/data/events.
// The Site is published from another folder, so nothing prepared reaches visitors
// until those files are there. This merges them: a session the Site lacks is
// added, a newer capture of one it has replaces the old index entry while the
// old file is preserved, and an older capture never replaces a newer one. It refuses when
// the prepared data was built for different code revisions than the Site's: the
// page ignores snapshots whose revisions do not match, so they would not show.
// It does not build or publish; run the Site's own sync/build and publish after.
import {createHash} from 'node:crypto';
import {mkdir, readFile, stat} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {atomicBytes,captureLock} from '../lib/atomic-json.mjs';
import {snapshotCompatible,tagCaptureRevisions} from '../lib/snapshot-policy.mjs';

const read = async file => readFile(file, 'utf8').then(JSON.parse);
const exists = file => stat(file).then(() => true, () => false);
const sha = buffer => createHash('sha256').update(buffer).digest('hex');

export async function codeRevisions(root) {
  const text = await readFile(path.join(root, 'lib', 'cache-revision.mjs'), 'utf8');
  const pick = name => new RegExp(name + '\\s*=\\s*["\']([^"\']+)').exec(text)?.[1];
  return {sourceRevision: pick('SOURCE_REVISION'), backendRevision: pick('BACKEND_REVISION'), measurementRevision: pick('RACE_REVISION')};
}

/** A snapshot file must be a readable gzip of JSON before it is allowed near the Site. */
async function readable(file) {
  try { JSON.parse(gunzipSync(await readFile(file)).toString('utf8')); return true; } catch { return false; }
}

async function newer(from, to) {
  if (!(await exists(to))) return true;
  const [a, b] = await Promise.all([readFile(from), readFile(to)]);
  return sha(a) !== sha(b) && (await stat(from)).mtimeMs > (await stat(to)).mtimeMs;
}

/** What syncing would do, without writing anything. */
export async function plan(from, to) {
  const data = root => path.join(root, 'assets', 'data');
  const problems = [], captures = [], packs = [];
  const wanted = await codeRevisions(to);
  const fromCaptures = await read(path.join(data(from), 'local-captures', 'index.json'));
  const fromPacks = await read(path.join(data(from), 'local-telemetry', 'index.json'));
  for (const key of ['sourceRevision', 'backendRevision', 'measurementRevision'])
    if (!snapshotCompatible(key,fromCaptures[key],wanted[key]))
      problems.push(`captures were prepared for ${key} ${fromCaptures[key]} but the Site's code is ${wanted[key]}; the page would ignore them`);
  if (fromPacks.sourceRevision !== wanted.sourceRevision)
    problems.push(`lap packs were prepared for sourceRevision ${fromPacks.sourceRevision} but the Site's code is ${wanted.sourceRevision}`);
  if (problems.length) return {problems, captures, packs, calendar: null};

  const toCaptures = await read(path.join(data(to), 'local-captures', 'index.json')).catch(() => ({...fromCaptures, entries: {}}));
  const toPacks = await read(path.join(data(to), 'local-telemetry', 'index.json')).catch(() => ({...fromPacks, entries: {}}));
  const siteMatches = ['sourceRevision', 'backendRevision', 'measurementRevision'].every(k => snapshotCompatible(k,toCaptures[k],wanted[k]));
  if (!siteMatches) problems.push("the Site's own capture index is for other revisions; its entries are already ignored by the page and will be replaced");

  for (const [key, entry] of Object.entries(fromCaptures.entries || {})) {
    const have = toCaptures.entries?.[key];
    const file = path.join(data(from), 'local-captures', entry.file);
    if (!await readable(file)) { problems.push(`unreadable capture file for ${key}`); continue; }
    if (!have || !siteMatches) captures.push({key, entry, action: 'add'});
    else if (Date.parse(entry.capturedAt) > Date.parse(have.capturedAt)) captures.push({key, entry, action: 'replace', superseded: have.file});
  }
  for (const [identity, file] of Object.entries(fromPacks.entries || {})) {
    const source = path.join(data(from), 'local-telemetry', file), target = path.join(data(to), 'local-telemetry', toPacks.entries?.[identity] || file);
    const have = toPacks.entries?.[identity];
    if (have && have === file && !await newer(source, target)) continue;
    if (!await readable(source)) { problems.push(`unreadable lap pack for ${identity}`); continue; }
    packs.push({identity, file, action: have ? 'replace' : 'add', superseded: have && have !== file ? have : null});
  }
  // The calendar carries each session's status; take the preparing checkout's when it is newer and complete.
  let calendar = null;
  const fromCal = path.join(data(from), 'events', '2026.json'), toCal = path.join(data(to), 'events', '2026.json');
  if (await exists(fromCal)) {
    const a = await read(fromCal), b = await read(toCal).catch(() => []);
    const sourceEvents=a.events || a, targetEvents=b.events || b;
    // Git checkout times are not capture times. Preserve previously confirmed
    // session statuses if the new calendar omits them or still says upcoming.
    const sameEvents=targetEvents.every(old=>sourceEvents.some(e=>e.round===old.round&&e.name===old.name));
    const merged=sourceEvents.map(current=>{
      const old=targetEvents.find(e=>e.round===current.round&&e.name===current.name);
      const statuses={...current.session_statuses};
      for(const [name,status] of Object.entries(old?.session_statuses||{}))
        if(['completed','cancelled'].includes(status)&&(!statuses[name]||statuses[name]==='upcoming'))statuses[name]=status;
      return Object.keys(statuses).length?{...current,session_statuses:statuses}:current;
    });
    const mergedCalendar=Array.isArray(a)?merged:{...a,events:merged};
    if (sameEvents && sourceEvents.length >= targetEvents.length && JSON.stringify(mergedCalendar)!==JSON.stringify(b))
      calendar = {file: '2026.json', rounds: sourceEvents.length, data:mergedCalendar};
  }
  return {problems, captures, packs, calendar, wanted, fromCaptures, toCaptures, fromPacks, toPacks, siteMatches};
}

export async function apply(from, to, p) {
  return captureLock(to,async commitJson=>{
    // Planning outside the shared lock must not overwrite a later capture.
    p=await plan(from,to);
    if(!p.wanted||p.problems.some(x=>x.startsWith('unreadable')))throw Error('Invalid prepared data');
    return applyLocked(from,to,p,commitJson);
  });
}

async function applyLocked(from,to,p,commitJson) {
  const data = root => path.join(root, 'assets', 'data');
  const put = async (source, target) => {
    await mkdir(path.dirname(target), {recursive: true});
    await atomicBytes(target,await readFile(source));
  };
  const captures = {...p.toCaptures, ...p.wanted, schema: p.fromCaptures.schema, entries: p.siteMatches ? tagCaptureRevisions(p.toCaptures) : {}};
  for (const {key, entry, superseded} of p.captures) {
    await put(path.join(data(from), 'local-captures', entry.file), path.join(data(to), 'local-captures', entry.file));
    captures.entries[key] = tagCaptureRevisions(p.fromCaptures)[key] || entry;
    // Retain the old content-addressed file: another index or a user may need it.
  }
  captures.generated = new Date().toISOString();
  // Build the captured calendar in the same index transaction, without
  // recursively acquiring the capture lock.
  if(p.calendar){
    const packed=(await import('node:zlib')).gzipSync(JSON.stringify(p.calendar.data.events||p.calendar.data));
    const file=sha(packed).slice(0,24)+'.json.gz';
    await atomicBytes(path.join(data(to),'local-captures',file),packed);
    captures.entries['/api/events?year=2026']={file,capturedAt:(await stat(path.join(data(from),'events',p.calendar.file))).mtime.toISOString()};
  }
  const packs = {...p.toPacks, sourceRevision: p.wanted.sourceRevision, schema: p.fromPacks.schema, entries: {...p.toPacks.entries}};
  for (const {identity, file, superseded} of p.packs) {
    await put(path.join(data(from), 'local-telemetry', file), path.join(data(to), 'local-telemetry', file));
    packs.entries[identity] = file;
    // Keep superseded packs rather than deleting user data during a sync.
  }
  await commitJson(path.join(data(to), 'local-telemetry', 'index.json'), packs);
  if (p.calendar) {
    const target=path.join(data(to), 'events', p.calendar.file);
    await commitJson(target,p.calendar.data);
  }
  // Commit captures last; all referenced files have been copied successfully.
  await commitJson(path.join(data(to), 'local-captures', 'index.json'),captures);
}

function describe(p) {
  const lines = [];
  const label = key => {
    const text = decodeURIComponent(key.split('?')[1] || key).replace(/\+/g, ' ');
    const params = Object.fromEntries(text.split(/&(?=[a-z_]+=)/).map(x => [x.split('=')[0], x.slice(x.indexOf('=') + 1)]));
    const what = key.split('?')[0].replace('/api/', '');
    return [what, params.gp, params.session && 'session ' + params.session, params.subject, params.windows && 'telemetry batch'].filter(Boolean).join(' · ');
  };
  for (const c of p.captures) lines.push(`  ${c.action.padEnd(8)} capture  ${label(c.key)}  (${c.entry.capturedAt})`);
  const bySession = {};
  for (const k of p.packs) { const s = k.identity.split(':').slice(1, 3).join(' '); (bySession[s] ||= []).push(k.action); }
  for (const [s, actions] of Object.entries(bySession)) lines.push(`  ${[...new Set(actions)].join('/').padEnd(8)} lap packs ${actions.length} × ${s}`);
  if (p.calendar) lines.push(`  replace  calendar  2026.json (${p.calendar.rounds} rounds)`);
  return lines.length ? lines.join('\n') : '  nothing to carry over: the Site already has everything prepared.';
}

async function main() {
  const args = process.argv.slice(2), arg = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
  const from = arg('--from'), to = arg('--to');
  if (!from || !to) { console.error('usage: sync-prepared-sessions.mjs --from <preparing checkout> --to <site checkout> [--apply]'); process.exit(2); }
  let p = await plan(path.resolve(from), path.resolve(to));
  const fatal = !p.wanted;
  for (const problem of p.problems) console.error((fatal ? 'refusing: ' : 'note: ') + problem);
  if (fatal || p.problems.some(x => x.startsWith('unreadable'))) process.exit(1);
  console.log(describe(p));
  if (!args.includes('--apply')) { console.log('\nDry run. Add --apply to write these into ' + path.resolve(to)); return; }
  if(!p.captures.length&&!p.packs.length&&!p.calendar){console.log('\nAlready up to date.');return;}
  // apply re-plans while holding the same OS lock as all capture writers.
  await apply(path.resolve(from), path.resolve(to), p);
  console.log('\nDone. Rebuild the Site (npm run sync:apex) and publish it.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
