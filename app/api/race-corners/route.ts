import {dataCache,dataResponse,dataError} from '../../../lib/site-data-cache';
import {loadRaceSnapshot} from '../../../lib/race-corner-loader.mjs';
export async function GET(request:Request) {
  const q=new URL(request.url).searchParams,year=Number(q.get('year')),lap=Number(q.get('lap')),gp=q.get('gp')||'',compound=q.get('compound')||'',subject=q.get('subject')||'team';
  if(!Number.isInteger(year)||year<2018||year>2100||!Number.isInteger(lap)||lap<2||lap>100||gp.length<3||gp.length>120||!['SOFT','MEDIUM','HARD'].includes(compound)||!['team','driver'].includes(subject))
    return Response.json({detail:'Invalid race snapshot'},{status:400});
  const cohort=q.get('cohort')||'';
  if(cohort&&!/^[A-Z0-9]{2,4}(,[A-Z0-9]{2,4}){2,21}$/.test(cohort))return Response.json({detail:'Invalid cohort'},{status:400});
  try{return dataResponse(await loadRaceSnapshot(dataCache,{year,gp,lap,compound,cohort,subject,round:q.get('round')||'',fresh:q.get('refresh')==='1'}));}
  catch(error){return dataError(error);}
}
