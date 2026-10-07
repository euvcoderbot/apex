import {dataCache,dataResponse,dataError} from '../../../lib/site-data-cache';
import {normalizeDataPath} from '../../../lib/data-cache.mjs';
export async function GET(request:Request) {
  const query=new URL(request.url).searchParams,path=query.get('path')||'';
  try{normalizeDataPath(path);}catch(error:any){return Response.json({detail:error.message},{status:400});}
  try{return dataResponse(await dataCache.get(path,{fresh:query.get('refresh')==='1'}));}
  catch(error){return dataError(error);}
}
export async function POST(request:Request) {
  // Read-only batch query: avoid expanding long qualifying windows in a URL.
  let body:any;
  try{body=await request.json();if(typeof body.path!=='string'||body.path.length>50000)throw new Error('Invalid batch query');normalizeDataPath(body.path);}
  catch(error:any){return Response.json({detail:error.message},{status:400});}
  try{return dataResponse(await dataCache.get(body.path,{fresh:body.refresh===true}));}
  catch(error){return dataError(error);}
}
