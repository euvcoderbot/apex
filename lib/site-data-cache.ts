import {env} from 'cloudflare:workers';
import {createDataCache} from './data-cache.mjs';
import {dataErrorResponse} from './http-errors.mjs';
import {publicDataResponse} from './http-data.mjs';
type Bucket={get(key:string):Promise<{json():Promise<any>}|null>;put(key:string,value:string,options?:any):Promise<unknown>};
async function storageKey(key:string) {
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));
  return 'performance-cache/'+Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')+'.json';
}
function bucket(){return (env as unknown as {DATA_CACHE?:Bucket}).DATA_CACHE;}
export const dataCache=createDataCache({
  seeded:true,
  sourceOrigin:'', // Hosted results are snapshots; new data is prepared locally.
  read:async(key:string)=>{const object=await bucket()?.get(await storageKey(key));return object?object.json():null;},
  write:async(key:string,value:unknown)=>{const bytes=JSON.stringify(value);if(bytes.length<8_000_000)await bucket()?.put(await storageKey(key),bytes,{httpMetadata:{contentType:'application/json'}});}
});
export function dataResponse(result:{data:unknown;cache:string;ttl:number},options:{fresh?:boolean}={}) {
  return publicDataResponse(result,options);
}
export function dataError(error:any) {
  return dataErrorResponse(error);
}
