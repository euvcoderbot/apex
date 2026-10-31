import {gunzipSync} from 'node:zlib';
export const object = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export function validateIndex(index,folder){
  if(!object(index)||!object(index.entries))throw Error(`Invalid ${folder} index: entries object required`);
  const schema=folder==='local-captures'?'apex-local-captures-v1':folder==='prerendered'?undefined:'native-lap-packs-v1';
  if(index.schema!==schema)throw Error(`Unsupported ${folder} schema: ${index.schema}`);
}
export function decodeSnapshot(bytes,{maximum=128*1024*1024}={}){
  if(bytes.length>32*1024*1024)throw Error('Compressed snapshot exceeds release budget');
  const value=JSON.parse(gunzipSync(bytes,{maxOutputLength:maximum}));
  if(!value||typeof value!=='object')throw Error('Invalid snapshot object');
  return value;
}
export function validatePayload(value,folder,route=''){
  const pathname=route?new URL(route,'http://release.invalid').pathname:'';
  if(folder==='telemetry'||folder==='local-telemetry'){
    if(!object(value)||!object(value.laps))throw Error('Native lap pack requires a laps object');
    for(const lap of Object.values(value.laps))if(!object(lap)||!Array.isArray(lap.samples))throw Error('Native lap requires samples array');
  }else if(pathname==='/api/session'){
    if(!object(value)||!Array.isArray(value.drivers))throw Error('Session snapshot requires drivers array');
  }else if(pathname==='/api/events'){
    if(!Array.isArray(value))throw Error('Calendar snapshot requires events array');
  }else if(pathname==='/api/performance'){
    if(!object(value)||!Array.isArray(value.teams)||typeof value.method!=='string')throw Error('Performance snapshot requires teams and method');
  }else if(!object(value))throw Error('API snapshot requires an object');
}
