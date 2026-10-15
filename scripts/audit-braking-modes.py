"""Replay retained exact qualifying laps and retain per-mode evidence for UI QA."""
import json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import performance_tracks as pt

prefix=sys.argv[1] if len(sys.argv)>1 else 'braking-before'
for gp,subject,file in [('Singapore','team','2026-Singapore-Grand-Prix-metric-replay-archive.json'),
                        ('Singapore','driver','2026-Singapore-Grand-Prix-metric-replay-driver-archive.json'),
                        ('Sepang','team','2026-Bahrain-Grand-Prix-metric-replay-archive.json')]:
    archive=json.loads((Path('../outputs')/file).read_text())
    result=pt.measure_field(archive['extracted'],archive['selections'],archive.get('corners') or [],{})
    rows=[]
    for name,t in result.get('teams',{}).items():
        zones=t.get('braking',[])
        rows.append({'name':name,'driver':t.get('selection',{}).get('driver'),'zones':len(zones),
                     'supported':sum(z.get('quality')=='supported' for z in zones),
                     'paired':sum(z.get('quality')=='supported' and z.get('approach_comparable',False) for z in zones),
                     'approach':sum(z.get('approach_time') is not None for z in zones)})
    payload={'gp':gp,'subject':subject,'selections':archive['selections'],'result':result}
    (Path('../outputs')/f'{prefix}-{gp}-{subject}.json').write_text(json.dumps(payload))
    print(json.dumps({'gp':gp,'subject':subject,'rows':rows,'excluded':result.get('excluded')}),flush=True)
