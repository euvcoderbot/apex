// Loopback-only dashboard: local Python compute + durable, versioned disk cache.
import http from 'node:http';
import path from 'node:path';
import {readFile,writeFile,mkdir,rename,unlink,readdir,open,stat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {createDataCache,normalizeDataPath,revisionUsable} from './data-cache.mjs';
import {loadRaceSnapshot,loadCachedRaceSnapshots} from './race-corner-loader.mjs';
import {loadQualifyingCorners} from './qualifying-corner-loader.mjs';
import {createTabLeases} from './local-tabs.mjs';
const mime={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.json':'application/json','.geojson':'application/json','.ico':'image/x-icon'};
export function diskStore(directory){
  const filename=key=>path.join(directory,createHash('sha256').update(key).digest('hex')+'.json');
  return {
    read:async key=>JSON.parse(await readFile(filename(key),'utf8')),
    write:async(key,value)=>{
      await mkdir(directory,{recursive:true});
      const target=filename(key),temp=target+'.'+randomUUID()+'.tmp';
      try{await writeFile(temp,JSON.stringify({...value,key}));await rename(temp,target);}
      finally{await unlink(temp).catch(()=>{});}
    }
  };
}
// Each methodology or source revision leaves its entries behind. Remove those
// once untouched for two weeks (another branch may still read them), and
// entries expired for over a week (an expired calendar is still consulted for
// expiry policy). Only the tail is read: entries end with {expires,bytes,key}.
export async function pruneDiskStore(directory,{now=Date.now(),dryRun=false}={}){
  let removed=0,freed=0,kept=0;
  const names=(await readdir(directory).catch(()=>[])).filter(name=>/^[0-9a-f]{64}\.json$/.test(name));
  for(const name of names){
    const file=path.join(directory,name);
    try{
      const {size,mtimeMs}=await stat(file),handle=await open(file,'r'),length=Math.min(size,65536),buffer=Buffer.alloc(length);
      try{await handle.read(buffer,0,length,size-length);}finally{await handle.close();}
      const tail=buffer.toString('utf8');
      const key=/"key":("(?:[^"\\]|\\.)*")\}$/.exec(tail),expires=/"expires":(\d+),(?:"bytes":\d+,)?"key":/.exec(tail);
      if(!key||!expires){kept++;continue;}
      const unreadable=!revisionUsable(JSON.parse(key[1]))&&mtimeMs<now-14*86400000;
      if(!unreadable&&Number(expires[1])>now-7*86400000){kept++;continue;}
      if(!dryRun)await unlink(file);removed++;freed+=size;
    }catch{kept++;}
  }
  return {removed,freed,kept};
}
export function createLocalDashboard({root,cacheRoot,sourceOrigin='http://127.0.0.1:8000',fetcher=fetch,onIdle,tabOptions={}}){
  const parsed=new URL(sourceOrigin);
  if(parsed.protocol!=='http:'||parsed.hostname!=='127.0.0.1')throw new Error('Local compute must use a loopback backend');
  const cache=createDataCache({...diskStore(cacheRoot),seeded:true,sourceOrigin,sourceTimeoutMs:180000,fetcher});
  const circuitCache=new Map();
  const tabConnections=new Map();
  const tabs=createTabLeases({...tabOptions,...(!onIdle?{pollMs:0}:{}),isConnected:id=>tabConnections.has(id),onEmpty:onIdle||(()=>{})});
  const hostedOrigin='https://f1apexdata.eufrandota14.chatgpt.site';
  function json(res,status,data,headers={}){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data));}
  const server=http.createServer(async(req,res)=>{
    // Never expose a local parser to DNS-rebinding or cross-site state changes.
    const host=req.headers.host||'';
    if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)){json(res,403,{detail:'Loopback host required'});return;}
    // Only health discovery is readable by the published site. Starting,
    // leasing, stopping and all calculations remain strictly same-origin.
    if(req.url?.split('?')[0]==='/api/local-status'&&req.headers.origin===hostedOrigin){
      const headers={'Access-Control-Allow-Origin':hostedOrigin,'Vary':'Origin','Access-Control-Allow-Methods':'GET, OPTIONS'};
      if(req.method==='OPTIONS'){json(res,204,null,headers);return;}
      if(req.method==='GET'){json(res,200,{mode:'local',sourceOrigin,autoStop:!!onIdle,...tabs.state()},headers);return;}
      json(res,405,{detail:'GET required'},headers);return;
    }
    if(req.headers.origin && ![`http://${host}`,`http://127.0.0.1:${server.address()?.port}`,`http://localhost:${server.address()?.port}`].includes(req.headers.origin)){json(res,403,{detail:'Same-origin requests required'});return;}
    try{
      const url=new URL(req.url,'http://127.0.0.1');
      if(url.pathname==='/api/local-status'){json(res,200,{mode:'local',compute:'Python on this machine',cache:'Persistent disk cache',upstream:'Direct public sources; no Vercel',sourceOrigin,autoStop:!!onIdle,...tabs.state()});return;}
      if(url.pathname==='/api/local-tab-stream'){
        const id=url.searchParams.get('id');
        if(req.method!=='GET'||!tabs.touch(id)){json(res,400,{detail:'Invalid tab connection'});return;}
        tabConnections.set(id,(tabConnections.get(id)||0)+1);
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive'});
        res.write('retry: 1000\ndata: connected\n\n');
        const ping=setInterval(()=>{tabs.touch(id);res.write(': alive\n\n');},15000);
        let released=false;
        const release=()=>{if(released)return;released=true;clearInterval(ping);const count=(tabConnections.get(id)||1)-1;if(count){tabConnections.set(id,count);}else{tabConnections.delete(id);tabs.release(id);}};
        res.once('close',release);res.once('error',release);return;
      }
      if(url.pathname==='/api/local-tab'){
        if(req.method!=='POST'){json(res,405,{detail:'POST required'});return;}
        let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>512){json(res,413,{detail:'Invalid tab lease'});return;}}
        const body=JSON.parse(raw);
        if(!['open','heartbeat','close'].includes(body.action)||!(body.action==='close'?(tabConnections.has(body.id)||tabs.release(body.id)):tabs.touch(body.id))){json(res,400,{detail:'Invalid tab lease'});return;}
        json(res,200,tabs.state());return;
      }
      if(url.pathname==='/apex/config.js'||url.pathname==='/config.js'){
        const config=await readFile(path.join(root,'config.js'),'utf8');
        res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});
        res.end(config.replace(/window\.APEX_API_ORIGIN = [^;]*;/,"window.APEX_API_ORIGIN = '';" )+'\nwindow.APEX_LOCAL_MODE = true;\n');return;
      }
      if(['/api/data','/api/race-corners','/api/qualifying-corners'].includes(url.pathname)){
        let result;
        if(url.pathname==='/api/data'){
          let query=url.searchParams.get('path'),fresh=url.searchParams.get('refresh')==='1';
          if(req.method==='POST'){
            const chunks=[];let size=0;
            for await(const chunk of req){size+=chunk.length;if(size>65000){json(res,413,{detail:'Batch query too large'});return;}chunks.push(chunk);}
            const body=JSON.parse(Buffer.concat(chunks));query=body.path;fresh=body.refresh===true;
          }else if(req.method!=='GET'){json(res,405,{detail:'GET or read-only POST required'});return;}
          normalizeDataPath(query||'');result=await cache.get(query,{fresh});
        }else{
          if(req.method!=='GET'){json(res,405,{detail:'GET required'});return;}
          const q=url.searchParams,options={year:Number(q.get('year')),gp:q.get('gp'),round:q.get('round')||'',lap:Number(q.get('lap')),compound:q.get('compound'),cohort:q.get('cohort')||'',subject:q.get('subject')||'team',model:q.get('model')||'matched',fresh:q.get('refresh')==='1'};
          if(!Number.isInteger(options.year)||options.year<2018||!options.gp){json(res,400,{detail:'Valid season and Grand Prix required'});return;}
          if(!['team','driver'].includes(options.subject)||!['matched','age-adjusted'].includes(options.model)){json(res,400,{detail:'Invalid comparison view'});return;}
          if(url.pathname==='/api/race-corners'&&q.get('cached')!=='1'&&(!Number.isInteger(options.lap)||options.lap<2||options.lap>100||!['SOFT','MEDIUM','HARD'].includes(options.compound))){json(res,400,{detail:'Select a valid race lap and compound'});return;}
          result=url.pathname==='/api/qualifying-corners'?await loadQualifyingCorners(cache,options):q.get('cached')==='1'?await loadCachedRaceSnapshots(cache,options):await loadRaceSnapshot(cache,options);
        }
        json(res,200,result.data,{'X-Data-Cache':result.cache,'X-Data-TTL':String(result.ttl),'X-Apex-Compute':'local'});return;
      }
      if(url.pathname==='/api/circuit-guide'){
        const key=url.searchParams.get('key'),year=Number(url.searchParams.get('year'));
        if(!/^\d{1,3}$/.test(key||'')||!Number.isInteger(year)||year<1950||year>2100){json(res,400,{detail:'Invalid circuit/year'});return;}
        async function circuit(part){
          const existing=circuitCache.get(part);if(existing?.expires>Date.now())return existing.data;
          const data=await cache.result('local-circuit-v1:'+part,async()=>{const r=await fetcher('https://api.multiviewer.app/api/v1/circuits'+part,{signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error('Circuit metadata unavailable');return r.json();},{ttl:86400});
          circuitCache.set(part,{data:data.data,expires:Date.now()+3600000});return data.data;
        }
        const index=await circuit(''),years=(index[key]?.years||[]).filter(y=>y<=year).sort((a,b)=>b-a);
        if(!years.length){json(res,404,{detail:'No circuit metadata for this year'});return;}
        const raw=await circuit(`/${key}/${years[0]}`);json(res,200,{sourceYear:years[0],requestedYear:year,name:raw.circuitName,x:raw.x,y:raw.y,corners:raw.corners,rotation:raw.rotation});return;
      }
      // Direct API calls still go to Python, never the hosted server.
      if(url.pathname.startsWith('/api/')){
        const target=url.pathname+url.search;normalizeDataPath(target);
        const result=await cache.get(target);json(res,200,result.data,{'X-Data-Cache':result.cache,'X-Apex-Compute':'local'});return;
      }
      if(req.method!=='GET'&&req.method!=='HEAD'){json(res,405,{detail:'GET required'});return;}
      // App paths (/apex/cars/corners) have no file of their own: they are the page.
      let relative=decodeURIComponent(url.pathname.replace(/^\/apex\/?/,'' )).replace(/^\//,'')||'index.html';
      if(!path.extname(relative))relative='index.html';
      const file=path.resolve(root,relative);
      if(!file.startsWith(path.resolve(root)+path.sep)){json(res,403,{detail:'Invalid asset path'});return;}
      const data=await readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:data);
    }catch(error){json(res,error.code==='ENOENT'?404:error.status||502,{detail:error.message});}
  });
  server.once('close',()=>tabs.dispose());
  return {server,cache,tabs};
}
