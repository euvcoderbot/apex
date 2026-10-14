"""Offline exact-fastest-lap replay; no production mutation."""
import json, sys
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import performance_tracks as pt
paths=[arg for arg in sys.argv[1:] if not arg.startswith('--')]
path=Path(paths[0] if paths else '../outputs/2026-Singapore-Grand-Prix-metric-replay.json')
data=json.loads(path.read_text())
entries=data['entries']; selections=[e['selection'] for e in entries]
extracted=[(e['selection']['team'],e['payload']['samples'],None) for e in entries]
if '--archive' in sys.argv:
    from session_loader import load_selected_laps_telemetry
    extracted=load_selected_laps_telemetry(data['year'],data['gp'],'Q',selections)
    Path(str(path).replace('.json','-archive.json')).write_text(json.dumps({'selections':selections,'extracted':extracted,'corners':data['session'].get('corners',[])}))
    print(json.dumps({'archive_samples':sum(len(s or []) for _,s,_ in extracted)}))
elif '--saved-archive' in sys.argv:
    saved=json.loads(Path(str(path).replace('.json','-archive.json')).read_text())
    extracted=saved['extracted']
original=pt.straight_core_measurements
def core(selected,blocks,grid,ref,fixed_windows=None,_cohort=False):
    if not _cohort:
        raw=ref['a'][ref['gps']]; distance=ref['aligned'][ref['gps']]
        x=np.interp(grid,distance,raw[:,5]);y=np.interp(grid,distance,raw[:,6]); kernel=np.ones(9)/9
        x=np.convolve(np.pad(x,(4,4),mode='edge'),kernel,mode='valid');y=np.convolve(np.pad(y,(4,4),mode='edge'),kernel,mode='valid')
        step=float(grid[1]-grid[0]); radius=max(1,int(25/step));i=np.arange(len(grid));l=np.maximum(0,i-radius);r=np.minimum(len(grid)-1,i+radius)
        heading=np.unwrap(np.arctan2(y[r]-y[l],x[r]-x[l]));turn=np.abs(heading[r]-heading[l]);speed=np.median([v['speed'] for v in selected.values()],axis=0)/3.6
        proxy=speed**2*turn/np.maximum(step,grid[r]-grid[l])/9.80665
        geo=(turn[:-1]<np.deg2rad(5))&(turn[1:]<np.deg2rad(5))&(proxy[:-1]<=.5)&(proxy[1:]<=.5)
        mids=(grid[:-1]+grid[1:])/2; bounded=np.zeros(len(mids),dtype=bool); legacy=bounded.copy()
        for start,end in blocks:
            length=grid[end]-grid[start]
            bounded|=(mids>=grid[start]+min(200,length*.2))&(mids<grid[end]-min(100,length*.1))
            legacy|=(mids>=grid[start]+200)&(mids<grid[end]-100)
        print(json.dumps({'core_input':{'teams':len(selected),'blocks':[[round(grid[a]),round(grid[b])] for a,b in blocks],
          'legacy_after_buffers_m':round(np.diff(grid)[legacy].sum()),'adaptive_after_buffers_m':round(np.diff(grid)[bounded].sum()),'geometry_m':round(np.diff(grid)[geo].sum()),'buffer_and_geometry_m':round(np.diff(grid)[geo&bounded].sum())}}))
        for team,item in selected.items():
            native=(item['throttle'][:-1]>=98)&(item['throttle'][1:]>=98)&~item['brake'][:-1]&~item['brake'][1:]
            ix=np.clip(np.searchsorted(item['aligned'],grid[:-1],side='right')-1,0,len(item['a'])-2)
            native&=pt.source_intervals(item)[ix]<=.6
            print(json.dumps({'core_team':team,'eligible_m':round(np.diff(grid)[native&bounded&geo].sum())}))
    return original(selected,blocks,grid,ref,fixed_windows,_cohort)
pt.straight_core_measurements=core
frame={}
corners=entries[0]['payload'].get('corners') or data['session'].get('corners') or []
result=pt.measure_field(extracted,selections,corners,frame)
zones=[z for t in result.get('teams',{}).values() for z in t.get('braking',[])]
print(json.dumps({'excluded':result.get('excluded'),'teams':len(result.get('teams',{})),'braking':len(zones),
 'supported':sum(z['quality']=='supported' for z in zones),'paired_supported':sum(z['quality']=='supported' and z.get('approach_comparable',False) for z in zones),
 'core_ranked':sum(t.get('straight_core_time') is not None for t in result.get('teams',{}).values()),'frame':list(frame)}))
Path(str(path).replace('.json','-result.json')).write_text(json.dumps(result))
