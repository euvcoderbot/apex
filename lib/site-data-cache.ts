import {env} from 'cloudflare:workers';
import {createDataCache} from './data-cache.mjs';
type Bucket={get(key:string):Promise<{json():Promise<any>}|null>;put(key:string,value:string,options?:any):Promise<unknown>};
async function storageKey(key:string) {
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));
  return 'performance-cache/'+Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')+'.json';
}
function bucket(){return (env as unknown as {DATA_CACHE?:Bucket}).DATA_CACHE;}
export const dataCache=createDataCache({
  read:async(key:string)=>{const object=await bucket()?.get(await storageKey(key));return object?object.json():null;},
  write:async(key:string,value:unknown)=>{const bytes=JSON.stringify(value);if(bytes.length<8_000_000)await bucket()?.put(await storageKey(key),bytes,{httpMetadata:{contentType:'application/json'}});}
});
export function dataResponse(result:{data:unknown;cache:string;ttl:number}) {
  return Response.json(result.data,{headers:{'X-Data-Cache':result.cache,
    'Cache-Control':result.ttl?`public, max-age=${Math.min(result.ttl,300)}, s-maxage=${Math.min(result.ttl,3600)}`:'no-store'}});
}
export function dataError(error:any) {
  console.error('Data load failed',error.message);
  const status=error.status>=400&&error.status<=599?error.status:error.name==='TimeoutError'?504:502;
  return Response.json({detail:error.message||'Data temporarily unavailable'},{status,headers:{'Cache-Control':'no-store'}});
}
