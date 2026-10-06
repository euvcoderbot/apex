"""Native cross-circuit replay; report omitted markers and exact timing math."""
import sys, json, gzip, time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import fastf1
from fastf1.mvapi import get_circuit_info
from session_loader import exact_event, download_feed, _PARSERS, load_selected_laps_telemetry
from performance_tracks import measure_field
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'outputs/braking-investigation-20261006'
fastf1.Cache.enable_cache(str(ROOT/'apex/.fastf1-cache'))
old=json.loads((ROOT/'metric-audit-fixed-evidence.json').read_text())['events']
CASES=[(2026,'Bahrain Grand Prix'),(2026,'Azerbaijan Grand Prix'),(2025,'Chinese Grand Prix'),
       (2025,'Japanese Grand Prix'),(2025,'British Grand Prix'),(2025,'Italian Grand Prix'),
       (2025,'Monaco Grand Prix'),(2021,'Portuguese Grand Prix')]
def replay(case):
    year,gp=case; started=time.perf_counter()
    try:
        path=OUT/f'{year}-{gp.replace(" ","-")}.json'
        meta=json.loads(path.read_text()) if path.exists() else next(e for e in old if (e['year'],e['gp'])==case)
        q=meta['Q'];windows=meta.get('windows') or [dict(l,team=t['team']+':'+str(i),team_name=t['team'],driver_number=l['number'])
            for t in q['teams'] for i,l in enumerate(t.get('telemetry_candidates',[]))]
        cache=OUT/f'native-{year}-{gp.replace(" ","-")}.json.gz'
        extracted=json.loads(gzip.decompress(cache.read_bytes())) if cache.exists() else load_selected_laps_telemetry(year,gp,'Q',windows)
        if not cache.exists():cache.write_bytes(gzip.compress(json.dumps(extracted).encode()))
        session=exact_event(year,gp).get_session('Q')
        info=_PARSERS['session_info'](session.api_path,response=download_feed(session.api_path,'session_info'))
        circuit=info['Meeting']['Circuit']; key=circuit['Key']
        markers=get_circuit_info(year=year,circuit_key=key)
        corners=[{'number':str(int(r['Number'])),'letter':str(r.get('Letter') or ''),'x':float(r['X']),'y':float(r['Y'])}
            for _,r in markers.corners.iterrows()] if markers is not None else []
        if key==12 and not corners:
            positions=[(0,.477778),(.094181,.517310),(.070923,.785614),(.479518,.992982),(.604422,.655322),(.774407,.745614),
                       (1,.466316),(.957504,.364211),(.547569,.291813),(.638783,.175322),(.572071,0),(.338821,.200585),
                       (.162902,.151111),(.095616,.249942),(.858059,.488187)]
            corners=[dict(number=str(i+1),x=x,y=y,normalized=True) for i,(x,y) in enumerate(positions)]
        before=measure_field(extracted,windows,[]);after=measure_field(extracted,windows,corners)
        rows=list(after.get('teams',{}).values()); first=rows[0] if rows else {}
        errors=[]
        for t in rows:
            if abs(sum(c['time'] for c in t['corners'])-t['corner_time'])>1e-6:errors.append('overlap or omitted timing')
            if abs(t['straight_time']+t['corner_time']-t['selection']['time'])>1e-6:errors.append('lap partition')
            for v in t['categories'].values():
                if v and abs(v['deficit']-v['time_lost']/t['reference_lap_time']*100)>1e-6:errors.append('percentage denominator')
        result={'year':year,'gp':gp,'circuit_key':key,'old_corners':before.get('corner_count'),
                'mapped_corners':after.get('corner_count'),'expected_markers':len(corners),'unmapped':after.get('unmapped_corners'),
                'teams':len(rows),'math_errors':errors,'error':after.get('error'),
                'corners':[{'corner':c['corner'],'band':c['band'],'speed':round(c['minimum'],1)} for c in first.get('corners',[])],
                'elapsed_s':round(time.perf_counter()-started,1)}
        print(json.dumps(result),flush=True)
        return result
    except Exception as exc:
        result={'year':year,'gp':gp,'error':str(exc)};print(json.dumps(result),flush=True);return result
if __name__ == '__main__':
    with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(replay,CASES))
    (ROOT/'outputs/corner-coverage-audit-20261006.json').write_text(json.dumps(results,indent=2))
