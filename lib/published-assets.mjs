import {cp,readFile} from 'node:fs/promises';
import path from 'node:path';

// Source captures remain intact. A deployment needs only the gzip payloads
// named by its indexes, not superseded export versions left in those folders.
export async function copyPublishedAssets(source,destination){
  const indexed=new Map();
  for(const folder of ['local-captures','local-telemetry','prerendered','telemetry']){
    try{
      const index=JSON.parse(await readFile(path.join(source,'data',folder,'index.json'),'utf8'));
      indexed.set(folder,new Set(Object.values(index.entries||{}).map(entry=>typeof entry==='string'?entry:entry.file)));
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return cp(source,destination,{recursive:true,filter:file=>{
    const parts=path.relative(source,file).split(path.sep);
    if(parts.length===3&&parts[0]==='data'&&indexed.has(parts[1])&&parts[2].endsWith('.json.gz'))return indexed.get(parts[1]).has(parts[2]);
    return !['index.oslock','index.lock'].includes(parts.at(-1))&&!parts.at(-1)?.endsWith('.tmp');
  }});
}
