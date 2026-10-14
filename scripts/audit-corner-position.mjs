import {createDataCache} from '../lib/data-cache.mjs';
import {qualifyingRepresentatives,circuitCornerMarkers,refineCornerPositions} from '../corner-geometry.js';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const root=resolve('../outputs/ui-cache');await mkdir(root,{recursive:true});
const file=k=>resolve(root,createHash('sha256').update(k).digest('hex')+'.json');
const cache=createDataCache({read:async k=>JSON.parse(await readFile(file(k),'utf8')),write:async(k,v)=>writeFile(file(k),JSON.stringify(v))});
const year=Number(process.argv[2]||2026),gp=process.argv[3]||'Singapore Grand Prix',round=process.argv[4]||'17';
const query=new URLSearchParams({year,gp,round,session:'Q'});
const session=(await cache.get('/api/session?'+query)).data;
const row=qualifyingRepresentatives(session,'driver').sort((a,b)=>a.time-b.time)[0];
for(const [key,value] of Object.entries({driver:row.driver.code,driver_number:row.driver.number,lap:row.lap,lap_time:row.time,lap_start_seconds:row.lap_start_seconds,lap_end_seconds:row.lap_end_seconds}))if(value!=null)query.set(key,String(value));
if(session.openf1_session_key)query.set('session_key',session.openf1_session_key);
const payload=(await cache.get('/api/telemetry?'+query)).data;
const markers=circuitCornerMarkers(payload,{...session,year,event:gp});
const total=payload.samples.at(-1).Distance-payload.samples[0].Distance;
console.log(JSON.stringify({gp,driver:row.driver.code,lap:row.lap,turns:markers.length,
  positions:refineCornerPositions(payload.samples,markers,total).map(m=>({turn:m.label,markerM:Math.round(m.fraction*total),bendM:Math.round(m.apexFraction*total),shiftM:Math.round(m.apexShiftMetres),method:m.apexMethod,reason:m.apexReason}))},null,2));
