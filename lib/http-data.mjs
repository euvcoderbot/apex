export function publicDataResponse(result,{fresh=false}={}){
  return Response.json(result.data,{headers:{'X-Data-Cache':result.cache,'X-Data-TTL':String(result.ttl),
    'Cache-Control':!fresh&&result.ttl>0?`public, max-age=${Math.min(result.ttl,300)}, s-maxage=${Math.min(result.ttl,3600)}`:'no-store'}});
}
