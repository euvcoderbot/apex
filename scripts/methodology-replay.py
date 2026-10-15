"""Freeze exact-source metrics; no network, no substitutions of performance laps."""
import json, sys, time
from pathlib import Path
root=sys.argv[sys.argv.index('--module-root')+1] if '--module-root' in sys.argv else str(Path(__file__).resolve().parents[1])
sys.path.insert(0,root)
from performance import race_estimates, fit_tyre_stint
from performance_tracks import measure_field
rows=[{'driver':d,'lap':i,'age':i,'compound':'MEDIUM','stint':1,'time':90+.02*i+.2*k}
      for k,d in enumerate('ABC') for i in range(3,23)]
extra=[{'driver':'D','lap':i,'age':i-38,'compound':'MEDIUM','stint':2,'time':90.5+.02*i} for i in range(41,61)]
cliff=[{'lap':i,'age':i,'time':90+.03*i+max(0,i-20)*.5} for i in range(1,31)]
result={'raceConnected':race_estimates(rows,False),'raceDisconnected':race_estimates(rows+extra,False),'tyreCliff':fit_tyre_stint(cliff),'telemetry':{}}
for name in ['2026-Singapore-Grand-Prix-metric-replay-archive.json','2026-Singapore-Grand-Prix-metric-replay-driver-archive.json','2026-Bahrain-Grand-Prix-metric-replay-archive.json']:
    path=Path('../outputs')/name
    if not path.exists():continue
    data=json.loads(path.read_text());start=time.perf_counter()
    measurement=measure_field(data['extracted'],data['selections'],data['corners'])
    result['telemetry'][name]={'seconds':time.perf_counter()-start,'result':measurement}
if '--corpus' in sys.argv:
    corpus=json.loads(Path(sys.argv[sys.argv.index('--corpus')+1]).read_text())
    for case in corpus:
        start=time.perf_counter();measurement=measure_field(case['extracted'],case['selections'],case['corners'])
        result['telemetry'][case['name']]={'seconds':time.perf_counter()-start,'result':measurement,'native_archive_sha256':case['native_archive_sha256']}
Path(sys.argv[1]).write_text(json.dumps(result,allow_nan=False))
print(json.dumps({'path':sys.argv[1],'raceConnected':list(result['raceConnected'][0]),'raceDisconnected':list(result['raceDisconnected'][0]),
 'tyreCliffUsed':result['tyreCliff']['samples'],'telemetry':{n:{'seconds':v['seconds'],'teams':len(v['result']['teams'])} for n,v in result['telemetry'].items()}}))
