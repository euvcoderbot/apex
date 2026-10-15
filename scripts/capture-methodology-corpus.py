"""Freeze existing native recordings + their exact fastest-lap selections/maps."""
import gzip,json,hashlib,sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import fastf1
from fastf1.mvapi import get_circuit_info
from session_loader import exact_event,download_feed,_PARSERS
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'outputs';OLD=OUT/'braking-investigation-20261006'
fastf1.Cache.enable_cache(str(ROOT/'apex/.fastf1-cache'))
reports=json.loads((ROOT/'metric-audit-fixed-evidence.json').read_text())['events']

def capture(path):
    name=path.name.removeprefix('native-').removesuffix('.json.gz');year=int(name[:4]);gp=name[5:].replace('-',' ')
    meta_path=OLD/(name+'.json')
    meta=json.loads(meta_path.read_text()) if meta_path.exists() else next(e for e in reports if e['year']==year and e['gp']==gp)
    windows=meta.get('windows') or [dict(l,team=t['team']+':'+str(i),team_name=t['team'],driver_number=l['number']) for t in meta['Q']['teams'] for i,l in enumerate(t.get('telemetry_candidates',[]))]
    selected=[]
    for team in meta['Q']['teams']:
        lap=team.get('lap')
        if not lap:continue
        own=[w for w in windows if w.get('team_name')==team['team'] and w.get('driver')==lap['driver'] and w.get('lap')==lap['lap'] and abs(w['time']-lap['time'])<.0005]
        if own:
            w=dict(own[0]);w.update(qualifying_best_time=lap['time'],qualifying_best_driver=lap['driver'],qualifying_best_lap=lap['lap']);selected.append(w)
    native=json.loads(gzip.decompress(path.read_bytes()));keys={w['team'] for w in selected};native=[row for row in native if row[0] in keys]
    session=exact_event(year,gp).get_session('Q');info=_PARSERS['session_info'](session.api_path,response=download_feed(session.api_path,'session_info'))
    key=info['Meeting']['Circuit']['Key'];markers=get_circuit_info(year=year,circuit_key=key)
    corners=[{'number':str(int(r['Number'])),'letter':str(r.get('Letter') or ''),'x':float(r['X']),'y':float(r['Y'])} for _,r in markers.corners.iterrows()] if markers is not None else []
    if key==12 and not corners:
        # Identical verified map fallback used by the production API. Freeze it
        # here once so both old/new calculations see exactly the same geometry.
        points=[(0,.477778),(.094181,.517310),(.070923,.785614),(.479518,.992982),(.604422,.655322),(.774407,.745614),
                (1,.466316),(.957504,.364211),(.547569,.291813),(.638783,.175322),(.572071,0),(.338821,.200585),
                (.162902,.151111),(.095616,.249942),(.858059,.488187)]
        corners=[dict(number=str(i+1),x=x,y=y,normalized=True) for i,(x,y) in enumerate(points)]
    result={'name':name,'year':year,'gp':gp,'selections':selected,'extracted':native,'corners':corners,'Q':meta['Q'],'R':meta.get('R'),
            'native_archive_sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
    print(json.dumps({'name':name,'fastest_laps':len(selected),'recordings':len(native),'markers':len(corners)}),flush=True)
    return result

if __name__=='__main__':
    with ThreadPoolExecutor(max_workers=2) as pool:cases=list(pool.map(capture,sorted(OLD.glob('native-*.json.gz'))))
    (OUT/'methodology-frozen-corpus.json').write_text(json.dumps(cases,allow_nan=False))
