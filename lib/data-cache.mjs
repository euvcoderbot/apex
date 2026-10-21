// Shared, disposable public-source cache. Versions change with source/methodology.
import {BACKEND_REVISION,RACE_REVISION,SOURCE_REVISION} from './cache-revision.mjs';
import verifiedSeed from './verified-cache-seed.json' with {type:'json'};
export const DATA_VERSION = 'data:'+BACKEND_REVISION;
export const SOURCE_VERSION = 'source:'+SOURCE_REVISION;
export const RACE_VERSION = 'race:'+RACE_REVISION;
// Native telemetry is format-compatible. Session payloads must refresh because
// they now advertise the retained native-lap inventory used by race planning.
const COMPATIBLE_SOURCE_REVISIONS = ['9d163fa2c79cdfff21fa','fc600b4970238be2ac20','29f8563d4b78ab40fa9f','cd189bb22d7369619f33'];
// These releases used identical v12 maths. Only source-recovery handlers
// changed. No v8/v111 scores or expired entries are promoted into this model.
const COMPATIBLE_RESULT_REVISIONS = ['8e425215bf81ef051824','41044143c0b685844c70','f51579844b9defd0a243'];
const allowed = new Set(['/api/events','/api/session','/api/telemetry','/api/performance','/api/performance/trace-batch','/api/performance/pits','/api/performance/sprint','/api/performance/race-laps']);
export function normalizeDataPath(path) {
  if(!path.startsWith('/api/')||path.includes('#'))throw new Error('Invalid data path');
  const url=new URL(path,'https://data.invalid');
  if(url.origin!=='https://data.invalid'||!allowed.has(url.pathname))throw new Error('Unsupported data path');
  const year=Number(url.searchParams.get('year'));
  if(!Number.isInteger(year)||year<2018||year>2100)throw new Error('Invalid season');
  if(url.pathname!=='/api/events'&&!(url.searchParams.get('gp')||'').trim())throw new Error('Missing Grand Prix');
  for(const key of ['fresh','_t','t'])url.searchParams.delete(key);
  // These are browser cache-busters, not FastAPI inputs. Session and car
  // calendars must share one durable response and one cold upstream request.
  if(['/api/events','/api/session'].includes(url.pathname))for(const key of ['status','data_schema'])url.searchParams.delete(key);
  url.searchParams.sort();return url.pathname+'?'+url.searchParams;
}
export function usableData(path,data) {
  const batch=path.startsWith('/api/performance/trace-batch?');
  if(!data||data.detail||data.error&&!batch||data.position_complete===false||data.lap_data_complete===false)return false;
  if(path.startsWith('/api/telemetry?'))return data.samples?.length>=30;
  if(path.startsWith('/api/session?'))return data.drivers?.length>0;
  if(path.startsWith('/api/performance?'))return data.teams?.length>0;
  if(path.startsWith('/api/performance/pits?'))return Array.isArray(data.visits)&&data.visits.length>0;
  if(path.startsWith('/api/performance/sprint?'))return data.classification_complete===true&&data.drivers?.length>0;
  if(path.startsWith('/api/performance/race-laps?'))return data.method==='native-race-streams-v1'&&data.laps?.length>0;
  // Supported entrants are useful even when another car has no source data.
  // Retain partial batches briefly; never cache empty/error responses.
  if(batch)return Object.values(data.teams||{}).some(trace=>trace&&!trace.error)
    ||Object.keys(data.speed_domain?.cars||{}).length>0; // speed-only batches
  return true;
}
export function dataTTL(path,data,calendar,now=Date.now()) {
  const policy=standardDataTTL(path,data,calendar,now);
  if(data.source_cache){const expiry=Date.parse(data.source_cache.expires_at||'');
    if(data.source_cache.stale)return Math.min(policy,120);
    if(Number.isFinite(expiry))return Math.max(0,Math.min(policy,Math.floor((expiry-now)/1000)));}
  return policy;
}
function standardDataTTL(path,data,calendar,now) {
  if(path.startsWith('/api/performance/trace-batch?')&&(data.error||Object.keys(data.excluded||{}).length)&&data.source_complete!==true)return 120;
  const url=new URL(path,'https://data.invalid'),year=Number(url.searchParams.get('year'));
  if(url.pathname==='/api/events')return year<new Date(now).getFullYear()?86400:300;
  const event=(Array.isArray(calendar)?calendar:calendar?.events||[]).find(e=>e.name===url.searchParams.get('gp'));
  const pits=url.pathname==='/api/performance/pits';
  // Incomplete timing/supplement failures must not become month-long blanks.
  if(pits&&(!data.visits?.length||data.stationary_status!=='complete'))return 300;
  const code=pits?'R':url.pathname==='/api/performance/sprint'?'S':url.searchParams.get('session')||'Q',name={Q:'Qualifying',R:'Race',S:'Sprint',FP1:'Practice 1',FP2:'Practice 2',FP3:'Practice 3'}[code]||code;
  const date=Date.parse(data.date||event?.session_dates?.[name]||'');
  // Recent weekends revalidate quickly for late timing/classification corrections.
  if(year<new Date(now).getFullYear())return 365*86400;
  // Completed old weekends are stable, not a weekly cold-cache workload.
  // Methodology keys and explicit Refresh invalidate them independently.
  return Number.isFinite(date)&&now-date>48*3600000?30*86400:120;
}
export function createDataCache({read,write,fetcher=fetch,now=Date.now,seeded=false,bootstrap=verifiedSeed,sourceOrigin='https://apex-telemetry-api.vercel.app',sourceTimeoutMs=55000}) {
  const memory=new Map(),pending=new Map(),reads=new Map();
  let memoryBytes=0,sourceActive=0,sourceLow=0,sourceBulk=0,bulkCooldownUntil=0;const sourceQueue=[];
  function drainSources(){
    sourceQueue.sort((a,b)=>b.priority-a.priority);
    while(sourceActive<6){const i=sourceQueue.findIndex(job=>job.bulk?sourceBulk<1:job.priority>0||sourceLow<4);if(i<0)break;sourceQueue.splice(i,1)[0].start();}
  }
  function sourceSlot(priority,bulk=false){return new Promise(resolve=>{
    const start=()=>{sourceActive++;if(!priority)sourceLow++;if(bulk)sourceBulk++;resolve(()=>{sourceActive--;if(!priority)sourceLow--;if(bulk)sourceBulk--;drainSources();});};
    sourceQueue.push({priority,bulk,start});drainSources();
  });}
  function retain(key,entry) {
    memoryBytes-=memory.get(key)?.bytes||0;
    entry.bytes ||= JSON.stringify(entry.data).length*3;
    memory.delete(key);memory.set(key,entry);
    memoryBytes+=entry.bytes;
    while(memory.size>128||memoryBytes>32_000_000){const oldest=memory.keys().next().value;memoryBytes-=memory.get(oldest).bytes;memory.delete(oldest);}
    return entry;
  }
  async function cached(key) {
    const entry=memory.get(key);
    if(entry?.expires>now())return retain(key,entry);
    if(!reads.has(key))reads.set(key,loadCached(key).finally(()=>reads.delete(key)));
    return reads.get(key);
  }
  async function loadCached(key) {
    const entry=await read(key).catch(()=>null);
    if(entry?.expires>now())return retain(key,entry);
    const sourceIdentity=key.startsWith(SOURCE_VERSION+':')?key.slice(SOURCE_VERSION.length+1):null;
    if(sourceIdentity&&/^\/api\/telemetry\?/.test(sourceIdentity)){
      for(const previous of COMPATIBLE_SOURCE_REVISIONS){
        const original=await read('source:'+previous+':'+sourceIdentity).catch(()=>null);
        if(original?.expires>now()&&usableData(sourceIdentity,original.data)){
          retain(key,original);await write(key,original).catch(()=>{});return original;
        }
      }
    }
    const identity=key.startsWith(DATA_VERSION+':')?key.slice(DATA_VERSION.length+1):null;
    if(identity)for(const previous of COMPATIBLE_RESULT_REVISIONS){
      const original=await read('data:'+previous+':'+identity).catch(()=>null),d=original?.data;
      const compatible=identity.startsWith('/api/performance?')&&d?.method==='car-performance-v13-supported-recovery'
        ||identity.startsWith('/api/performance/pits?')&&Array.isArray(d?.visits);
      if(original?.expires>now()&&compatible&&usableData(identity,d)){
        retain(key,original);await write(key,original).catch(()=>{});return original;
      }
    }
    // Bootstrap only trusted build-time results. Never renew their original
    // expiry, cross a methodology revision, or use them for manual refreshes.
    if(seeded){
      const match=/^(source|data|race):([^:]+):(.*)$/.exec(key);
      if(match){
        const [,family,revision,identity]=match;
        const revisions={source:[SOURCE_REVISION,bootstrap.sourceRevision],data:[BACKEND_REVISION,bootstrap.backendRevision],race:[RACE_REVISION,bootstrap.raceRevision]};
        const [current,captured]=revisions[family];
        const seed=revision===current&&captured===current?bootstrap.entries[family+':'+identity]:null;
        if(seed?.expires>now()){
          retain(key,seed);await write(key,seed).catch(()=>{});return seed;
        }
      }
    }
    return null;
  }
  async function remember(key,data,ttl) {
    const entry=retain(key,{data,expires:now()+ttl*1000});
    await write(key,entry).catch(()=>{});return entry;
  }
  async function result(key,compute,{fresh=false,ttl=120,valid=()=>true}={}) {
    const hit=fresh?null:await cached(key);
    if(hit)return {data:hit.data,cache:'HIT',ttl:Math.max(1,Math.floor((hit.expires-now())/1000))};
    // One cold calculation per key; requests may stop waiting without losing the fill.
    const flightKey=key+(fresh?':refresh':'');
    if(!pending.has(flightKey))pending.set(flightKey,(async()=>{
      const data=await compute(),seconds=typeof ttl==='function'?await ttl(data):ttl;
      const usable=valid(data);
      if(usable&&seconds>0)await remember(key,data,seconds);
      return {data,cache:'MISS',ttl:usable?seconds:0};
    })().finally(()=>pending.delete(flightKey)));
    return pending.get(flightKey);
  }
  async function get(path,{fresh=false,priority}={}) {
    const normalized=normalizeDataPath(path),key=(/^\/api\/(events|session|telemetry)\?/.test(normalized)?SOURCE_VERSION:DATA_VERSION)+':'+normalized;
    return result(key,async()=>{
      const source=new URL(normalized,sourceOrigin);
      if(fresh)source.searchParams.set('fresh','true');
      // Race-repeat telemetry cannot occupy every slot and block a foreground
      // category switch. Summary/batch requests get priority and two slots are
      // reserved against background native telemetry saturation.
      const bulk=source.pathname==='/api/performance/race-laps';
      const release=await sourceSlot(priority??(source.pathname==='/api/telemetry'||bulk?0:2),bulk);
      try{
        if(bulk&&bulkCooldownUntil>now()){const error=new Error('Native source rate limited; cached results retained. Retry after the source cooldown.');error.status=429;throw error;}
        const response=await fetcher(source,{signal:AbortSignal.timeout(sourceTimeoutMs)});
        const data=await response.json();
        if(!response.ok){const error=new Error(data.detail||'Source data unavailable');error.status=response.status;if(bulk&&(response.status===429||/429|rate limit/i.test(error.message)))bulkCooldownUntil=now()+60000;throw error;}
        return data;
      }finally{release();}
    },{fresh,valid:data=>usableData(normalized,data),ttl:async data=>{
      const year=new URL(normalized,'https://data.invalid').searchParams.get('year');
      const calendarKey=SOURCE_VERSION+':/api/events?year='+year;
      let calendar=await cached(calendarKey);
      // A slow telemetry calculation may outlive the calendar's five-minute
      // freshness. Recent captured dates remain usable for expiry policy only;
      // never serve this stale entry as the calendar or session-status response.
      if(!calendar){const metadata=memory.get(calendarKey)||await read(calendarKey).catch(()=>null);if(metadata?.expires>now()-7*86400000)calendar=metadata;}
      return dataTTL(normalized,data,calendar?.data,now());
    }});
  }
  async function peek(key){const hit=await cached(key);return hit?{data:hit.data,cache:'HIT',ttl:Math.max(1,Math.floor((hit.expires-now())/1000))}:null;}
  return {get,result,peek};
}
