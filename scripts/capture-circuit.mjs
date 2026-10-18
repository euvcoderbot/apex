import {writeFile} from 'node:fs/promises';
const [key,yearText,output]=process.argv.slice(2),year=Number(yearText);
if(!/^\d{1,3}$/.test(key||'')||!Number.isInteger(year)||year<2018||year>2100||!output)throw Error('Provide circuit key, year and output file.');
async function get(url){const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Circuit source HTTP '+r.status);return r.json();}
const index=await get('https://api.multiviewer.app/api/v1/circuits');
const source_year=Math.max(...(index[key]?.years||[]).filter(y=>y<=year));
if(!Number.isFinite(source_year))throw Error('No circuit metadata for this year.');
const circuit=await get(`https://api.multiviewer.app/api/v1/circuits/${key}/${source_year}`);
if(circuit.circuitKey!==Number(key)||!circuit.corners?.length)throw Error('Circuit source identity mismatch.');
await writeFile(output,JSON.stringify({source_year,circuit}));
