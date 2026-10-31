// Unexpected storage/runtime errors must not echo paths, secrets or stack text.
export function dataErrorResponse(error,log=console.error){
  const requestId=crypto.randomUUID();
  const explicit=Number.isInteger(error?.status)&&error.status>=400&&error.status<=599;
  const status=explicit?error.status:error?.name==='TimeoutError'?504:502;
  log(JSON.stringify({event:'data_error',request_id:requestId,status,error_name:error?.name||'Error'}));
  const detail=explicit?String(error.message||'Data unavailable').slice(0,500):'Data temporarily unavailable';
  return Response.json({detail,request_id:requestId},{status,headers:{'Cache-Control':'no-store','X-Request-ID':requestId}});
}
