import {readFile,writeFile} from 'node:fs/promises';
import {fastestTeamTelemetrySelections} from '../qualifying-telemetry.js';
import {normalizeDataPath} from '../lib/data-cache.mjs';
import {BACKEND_REVISION} from '../lib/cache-revision.mjs';
const file='lib/verified-cache-seed.json',seed=JSON.parse(await readFile(file,'utf8'));
const [key,entry]=Object.entries(seed.entries).find(([k])=>k.startsWith('data:')&&k.includes('session=Q'));
const query=new URL(key.slice(5),'https://data.invalid');
const selections=fastestTeamTelemetrySelections(entry.data.teams);
const identity=normalizeDataPath('/api/performance/trace-batch?'+new URLSearchParams({year:query.searchParams.get('year'),gp:query.searchParams.get('gp'),windows:JSON.stringify(selections)}));
const response=await fetch('https://apex-telemetry-api.vercel.app'+identity,{signal:AbortSignal.timeout(55000)}),data=await response.json();
if(!response.ok||data.error||Object.keys(data.teams||{}).length!==selections.length||Object.keys(data.excluded||{}).length||data.braking_selection_policy!=='fastest-qualifying-lap-only')throw new Error('Only complete, exact-fastest qualifying calculations can be captured.');
let measurements=0;
for(const s of selections){const trace=data.teams[s.team],actual=trace.braking_selection;
  if(!actual||actual.driver!==s.driver||actual.lap!==s.lap||Math.abs(actual.time-s.time)>.0005)throw new Error('Wrong source lap: '+s.team);
  for(const z of trace.braking||[]){const g=(z.entry_speed-z.exit_speed)/3.6/z.duration/9.80665;
    if(Math.abs(g-z.mean_g)>1e-8||z.source_selection.lap!==s.lap||z.source_selection.driver!==s.driver)throw new Error('Invalid braking timing/source math: '+s.team);
    measurements++;
  }
}
seed.backendRevision=BACKEND_REVISION;seed.entries['data:'+identity]={data,expires:entry.expires};
await writeFile(file,JSON.stringify(seed));
console.log(JSON.stringify({teams:selections.length,measurements,originalExpiry:entry.expires,requestBytes:identity.length}));
