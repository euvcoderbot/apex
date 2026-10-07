// Import only this task's verified, unexpired public-source results. No public
// cache-write route exists; source/method revisions gate the bundled bootstrap.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {raceCornerGroups} from '../race-cornering.js';
import {normalizeDataPath} from '../lib/data-cache.mjs';
import {SOURCE_REVISION,BACKEND_REVISION,RACE_REVISION} from '../lib/cache-revision.mjs';
const [directory,oldCalculation]=process.argv.slice(2),entries={};
async function entry(key){try{return JSON.parse(await readFile(directory+'/'+createHash('sha256').update(key).digest('hex')+'.json','utf8'));}catch{return null;}}
const paths=['/api/session?year=2026&gp=Bahrain Grand Prix&round=16&session=R','/api/session?year=2026&gp=Bahrain Grand Prix&round=16&session=Q',
 '/api/performance?year=2026&gp=Bahrain Grand Prix&session=R','/api/performance?year=2026&gp=Bahrain Grand Prix&session=Q'];
let session,performance,sessionExpiry;
for(const path of paths){const identity=normalizeDataPath(path),raw=identity.startsWith('/api/session?'),cached=await entry((raw?'source:'+SOURCE_REVISION:'data:'+oldCalculation)+':'+identity);
 if(!cached)continue;
 // Completed-event API summaries had the short fallback TTL because their
 // calendar metadata expired before calculation finished. Keep their original
 // capture age, but apply the existing seven-day completed-session policy.
 if(!raw&&session&&Date.now()-Date.parse(session.date)>48*3600000)
   cached.expires=Math.min(sessionExpiry,cached.expires-120000+604800000);
 if(cached.expires<=Date.now())continue;entries[(raw?'source:':'data:')+identity]=cached;
 if(identity.includes('session=R')){if(raw){session=cached.data;sessionExpiry=cached.expires;}else performance=cached.data;}}
if(!session||!performance)throw new Error('Verified complete race-session inputs are required.');
const preferred=Object.fromEntries(performance.teams.map(t=>[t.team,t.fastest_race_driver]));
let snapshots=0;const teams=new Set();
for(const subject of ['team','driver'])for(const group of raceCornerGroups(session,preferred,24,subject)){
 const identity=new URLSearchParams({year:2026,gp:'Bahrain Grand Prix',round:16,lap:group.lap,compound:group.compound,cohort:group.cohort,subject}).toString();
 const cached=await entry('race:'+oldCalculation+':'+identity);
 if(!cached||cached.expires<=Date.now()||!cached.data.complete||cached.data.requestErrors?.length||cached.data.observations.length<3)continue;
 entries['race:'+identity]=cached;snapshots++;cached.data.observations.forEach(o=>teams.add(o.team));
}
if(teams.size<11)throw new Error('Bootstrap must cover the verified eleven-team race analysis.');
await writeFile('lib/verified-cache-seed.json',JSON.stringify({sourceRevision:SOURCE_REVISION,backendRevision:BACKEND_REVISION,raceRevision:RACE_REVISION,entries}));
console.log(JSON.stringify({snapshots,teams:teams.size,entries:Object.keys(entries).length}));
