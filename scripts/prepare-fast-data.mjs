import { mkdir, writeFile, readdir, readFile, stat } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const root = 'assets/data';
await mkdir(`${root}/events`, { recursive: true });
await mkdir(`${root}/sessions`, { recursive: true });
const years = Array.from({length: new Date().getFullYear() - 2014 + 1}, (_, i) => 2014 + i);
for (let start = 0; start < years.length; start += 4) {
  await Promise.all(years.slice(start, start + 4).map(async year => {
    const response = await fetch(`https://apex-telemetry-api.vercel.app/api/events?year=${year}`, {signal: AbortSignal.timeout(60000)});
    if (!response.ok) throw new Error(`Calendar ${year}: ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data) || !data.length) throw new Error(`Empty calendar ${year}`);
    await writeFile(`${root}/events/${year}.json`, JSON.stringify(data));
    console.log(`Calendar ${year}: ${data.length} events`);
  }));
}
const manifest = {};
const files = await readdir('.apex-cache');
const candidates = await Promise.all(files.filter(n => n.startsWith('session-')).map(async name => ({name,mtime:(await stat(`.apex-cache/${name}`)).mtimeMs})));
for (const {name} of candidates.sort((a,b)=>a.mtime-b.mtime)) {
  const data = JSON.parse(gunzipSync(await readFile(`.apex-cache/${name}`)));
  const year = Number(String(data.date).slice(0,4));
  if (!year || year >= new Date().getFullYear() || !data.drivers?.length || data.circuit_rotation == null) continue;
  const key = `${year}:${data.event}:${data.session}`;
  const file = `${createHash('sha256').update(key).digest('hex').slice(0,20)}.json`;
  await writeFile(`${root}/sessions/${file}`, JSON.stringify(data));
  manifest[key] = file;
}
await writeFile(`${root}/sessions/index.json`, JSON.stringify(manifest));
console.log(`${Object.keys(manifest).length} prepared historical sessions`);
