import {dataCache,dataResponse,dataError} from '../../../lib/site-data-cache';
import {loadQualifyingCorners} from '../../../lib/qualifying-corner-loader.mjs';
export async function GET(request:Request){
  const q=new URL(request.url).searchParams,year=Number(q.get('year')),gp=q.get('gp')||'',subject=q.get('subject')||'team';
  if(!Number.isInteger(year)||year<2018||year>2100||gp.length<3||gp.length>120||!['team','driver'].includes(subject))return Response.json({detail:'Invalid qualifying query'},{status:400});
  try{return dataResponse(await loadQualifyingCorners(dataCache,{year,gp,round:q.get('round')||'',subject,fresh:q.get('refresh')==='1'}));}
  catch(error){return dataError(error);}
}
