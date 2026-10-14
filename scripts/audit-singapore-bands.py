"""Replay exact cached source laps and disclose local crossing exclusions."""
import json, sys, runpy
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import performance_tracks as pt

path = Path(sys.argv[1] if len(sys.argv)>1 else '../outputs/2026-Singapore-Grand-Prix-metric-replay-driver-archive.json')
data = json.loads(path.read_text())
original = pt.matched_braking_measurements
def braking(selected, windows, grid, candidates=None, fixed_ranges=None):
    result = original(selected, windows, grid, candidates, fixed_ranges)
    print(json.dumps({'windows': {k: [round(grid[a]), round(grid[b]), mode, sorted(onsets)]
                                  for k,(a,b,onsets,mode) in windows.items()}}))
    for team, item in selected.items():
        a,d=item['a'],item['aligned']
        rejected=[]
        for label,(_,end,onsets,mode) in windows.items():
            if team not in onsets or mode!='straight': continue
            ix=np.flatnonzero((d>=grid[onsets[team]]-20)&(d<=grid[end])&(a[:,4]>=.5))
            rejected.append([label,len(ix),a[ix,2].tolist(),np.round(pt.source_intervals(item)[ix[:-1]],3).tolist()])
        print(json.dumps({'brake':team,'accepted':len(result[team]),'segments':rejected}))
    return result
pt.matched_braking_measurements=braking
result=pt.measure_field(data['extracted'],data['selections'],data['corners'])
checks=runpy.run_path(str(Path(__file__).with_name('audit-metric-matrix.py')))['trace_checks'](result)
if checks:
    raise AssertionError(checks)
print(json.dumps({'math_checks':'passed: partitions, units, braking g, distance normalisation and specific power'}))
print(json.dumps({'excluded':result['excluded']}))
for name,row in result['teams'].items():
    if name=='ALB':
        selection=row['selection']
        raw=next(samples for key,samples,_ in data['extracted'] if key==selection['team'])
        print(json.dumps({'ALB_native_zone4':[[r.get(k) for k in ('Distance','ElapsedSeconds','Speed','Throttle','Brake')]
            for r in raw if 3080<r['Distance']<3300]}))
print(json.dumps({'bands':{b:{'ranked':sum(b in t.get('accel_bands',{}) for t in result['teams'].values()),
    'observed':sum(any(o['band']==b for o in t.get('accel_observations',[])) for t in result['teams'].values())}
    for b in ['100_150','150_200','200_250','250_300','300_320']}}))
