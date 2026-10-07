// Shared, disposable public-source cache. Versions change with source/methodology.
import {CACHE_REVISION,SOURCE_REVISION} from './cache-revision.mjs';
export const DATA_VERSION = 'data:'+CACHE_REVISION;
export const SOURCE_VERSION = 'source:'+SOURCE_REVISION;
export const RACE_VERSION = 'race:'+CACHE_REVISION;
const allowed = new Set(['/api/events','/api/session','/api/telemetry','/api/performance','/api/performance/trace-batch','/api/performance/pits']);
export function normalizeDataPath(path) {
  if(!path.startsWith('/api/')||path.includes('#'))throw new Error('Invalid data path');
  const url=new URL(path,'https://data.invalid');
  if(url.origin!=='https://data.invalid'||!allowed.has(url.pathname))throw new Error('Unsupported data path');
  const year=Number(url.searchParams.get('year'));
  if(!Number.isInteger(year)||year<2018||year>2100)throw new Error('Invalid season');
  if(url.pathname!=='/api/events'&&!(url.searchParams.get('gp')||'').trim())throw new Error('Missing Grand Prix');
  for(const key of ['fresh','_t','t'])url.searchParams.delete(key);
  url.searchParams.sort();return url.pathname+'?'+url.searchParams;
}
export function usableData(path,data) {
  if(!data||data.detail||data.error||data.position_complete===false||data.lap_data_complete===false)return false;
  if(path.startsWith('/api/telemetry?'))return data.samples?.length>=30;
  if(path.startsWith('/api/session?'))return data.drivers?.length>0;
  if(path.startsWith('/api/performance?'))return data.teams?.length>0;
  if(path.startsWith('/api/performance/trace-batch?'))return Object.keys(data.teams||{}).length>0&&!Object.keys(data.excluded||{}).length;
  return true;
}
export function dataTTL(path,data,calendar,now=Date.now()) {
  const url=new URL(path,'https://data.invalid'),year=Number(url.searchParams.get('year'));
  if(url.pathname==='/api/events')return year<new Date(now).getFullYear()?86400:30;
  const event=(Array.isArray(calendar)?calendar:calendar?.events||[]).find(e=>e.name===url.searchParams.get('gp'));
  const code=url.searchParams.get('session')||'Q',name={Q:'Qualifying',R:'Race',FP1:'Practice 1',FP2:'Practice 2',FP3:'Practice 3'}[code]||code;
  const date=Date.parse(data.date||event?.session_dates?.[name]||'');
  // Recent weekends revalidate quickly for late timing/classification corrections.
  return year<new Date(now).getFullYear()||Number.isFinite(date)&&now-date>48*3600000?7*86400:120;
}
export function createDataCache({read,write,fetcher=fetch,now=Date.now}) {
  const memory=new Map(),pending=new Map();
  async function cached(key) {
    const entry=memory.get(key)||await read(key).catch(()=>null);
    if(entry&&entry.expires>now()){memory.set(key,entry);return entry;}
    return null;
  }
  async function remember(key,data,ttl) {
    const entry={data,expires:now()+ttl*1000};memory.set(key,entry);
    if(memory.size>128)memory.delete(memory.keys().next().value);
    await write(key,entry).catch(()=>{});return entry;
  }
  async function result(key,compute,{fresh=false,ttl=120,valid=()=>true}={}) {
    const hit=fresh?null:await cached(key);
    if(hit)return {data:hit.data,cache:'HIT',ttl:Math.max(1,Math.floor((hit.expires-now())/1000))};
    // One cold calculation per key; requests may stop waiting without losing the fill.
    const flightKey=key+(fresh?':refresh':'');
    if(!pending.has(flightKey))pending.set(flightKey,(async()=>{
      const data=await compute(),seconds=typeof ttl==='function'?await ttl(data):ttl;
      if(valid(data)&&seconds>0)await remember(key,data,seconds);
      return {data,cache:'MISS',ttl:valid(data)?seconds:0};
    })().finally(()=>pending.delete(flightKey)));
    return pending.get(flightKey);
  }
  async function get(path,{fresh=false}={}) {
    const normalized=normalizeDataPath(path),key=(/^\/api\/(events|session|telemetry)\?/.test(normalized)?SOURCE_VERSION:DATA_VERSION)+':'+normalized;
    return result(key,async()=>{
      const source=new URL(normalized,'https://apex-telemetry-api.vercel.app');
      if(fresh)source.searchParams.set('fresh','true');
      const response=await fetcher(source,{signal:AbortSignal.timeout(55000)});
      const data=await response.json();
      if(!response.ok){const error=new Error(data.detail||'Source data unavailable');error.status=response.status;throw error;}
      return data;
    },{fresh,valid:data=>usableData(normalized,data),ttl:async data=>{
      const year=new URL(normalized,'https://data.invalid').searchParams.get('year');
      const calendar=await cached(SOURCE_VERSION+':/api/events?year='+year);
      return dataTTL(normalized,data,calendar?.data,now());
    }});
  }
  return {get,result};
}
