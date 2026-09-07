// Explicitly run for asset refresh only; never part of the build.
import { mkdir, writeFile } from 'node:fs/promises';
const teamPage = 'https://www.formula1.com/en/teams';
const tyrePage = 'https://www.pirelli.com/tires/en-us/motorsport/car/formula-1';
const [teams, tyres] = await Promise.all([teamPage, tyrePage].map(async url => {
  const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.text();
}));
const teamUrls = [...new Set(teams.match(/https:\/\/media\.formula1\.com\/[^"\s<>\\]+2026[a-z0-9]+logowhite\.webp/g))];
if (teamUrls.length !== 11) throw new Error(`Expected 11 team marks, found ${teamUrls.length}`);
const jobs = teamUrls.map(url => ({url, source: teamPage, path: `assets/teams/official/${url.match(/2026([a-z0-9]+)logowhite/)[1]}.webp`}));
const slicks = [...new Set(tyres.match(/assets\/motorsport\/carousel\/pirelli-motorsport-car-Formula1-SlickTyres-[a-z]+-2026\.png/g))];
const names = { red: 'soft', white: 'hard', yellow: 'medium' };
for (const path of slicks) {
  const color = path.match(/SlickTyres-([a-z]+)/)[1];
  if (names[color]) jobs.push({url:`https://tyre24.pirelli.com/motorsport/${path}`, source:tyrePage, path:`assets/tyres/official/${names[color]}.png`});
}
for (const [color, name] of [['green', 'intermediate'], ['blu', 'wet']]) {
  const encoded = tyres.match(new RegExp(`https%3A%2F%2Ftyre24[^"<>\\s]+WetTyres-${color}-senzaombra-2026\\.png`));
  if (encoded) jobs.push({url: decodeURIComponent(encoded[0]), source:tyrePage, path:`assets/tyres/official/${name}.png`});
}
await mkdir('assets/teams/official', {recursive:true});
await mkdir('assets/tyres/official', {recursive:true});
await Promise.all(jobs.map(async job => {
  const response = await fetch(job.url, {signal:AbortSignal.timeout(30000)});
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error(`Invalid asset ${response.status}: ${job.url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(job.path, bytes);
  console.log(`${job.path}: ${bytes.length} bytes`);
}));
await writeFile('assets/official-sources.json', JSON.stringify({retrieved:'2026-09-07', notice:'Third-party trademarks and copyrighted images. Sources are not a redistribution licence. Local preview use; review rights before public publication.', assets:jobs}, null, 2));
