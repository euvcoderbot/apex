const ORIGIN = 'https://api.multiviewer.app/api/v1/circuits';
const cache = new Map<string, { expires: number; data: unknown }>();
async function upstream(path: string) {
  const existing = cache.get(path);
  if (existing && existing.expires > Date.now()) return existing.data as any;
  const response = await fetch(ORIGIN + path, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('Circuit metadata unavailable');
  const data = await response.json();
  if (cache.size > 150) cache.clear();
  cache.set(path, { expires: Date.now() + 3600000, data });
  return data;
}
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const key = query.get('key') || '';
  const year = Number(query.get('year'));
  if (!/^\d{1,3}$/.test(key) || !Number.isInteger(year) || year < 1950 || year > 2100) return Response.json({error:'Invalid circuit/year'}, {status:400});
  try {
    const index = await upstream('');
    const years = (index[key]?.years || []).filter((v:number) => v <= year).sort((a:number,b:number)=>b-a);
    if (!years.length) return Response.json({error:'No circuit metadata for this year'}, {status:404});
    const sourceYear = years[0];
    const raw = await upstream(`/${key}/${sourceYear}`);
    return Response.json({sourceYear, requestedYear:year, name:raw.circuitName, x:raw.x, y:raw.y, corners:raw.corners, rotation:raw.rotation}, {headers:{'Cache-Control':'public, max-age=3600'}});
  } catch {
    return Response.json({error:'Circuit provider temporarily unavailable'}, {status:502});
  }
}
