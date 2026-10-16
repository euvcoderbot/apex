"""Replay exact retained fastest qualifying laps; print old GPS-clock vs new speed estimate."""
import sys,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from verified_sources import recorded_session,performance_input,recorded_lap
from performance import analyze
from performance_tracks import measure_field
gp=sys.argv[1] if len(sys.argv)>1 else 'Singapore Grand Prix'
record=recorded_session(2026,gp,'Q');selected={}
for team in analyze(performance_input(record),2)['teams']:
    lap=team['lap'];row=recorded_lap(record,driver=lap['driver'],lap=lap['lap'])
    selected[team['team']]={**row,'selection':{**row['selection'],'team':team['team'],'team_name':team['team']}}
selections=[r['selection'] for r in selected.values()]
result=measure_field([(s['team'],selected[s.get('team_name',s['team'])]['samples'],None) for s in selections],selections,record.get('corners',[]))
rows=[]
for team,t in result['teams'].items():
    if t.get('straight_core_time') is None:continue
    estimate=t['straight_core_time'];observed=t['straight_core_observed_time'];distance=t['straight_core_distance_m']
    rows.append({'team':team,'driver':t['selection']['driver'],'lap':t['selection']['lap'],'distance_m':round(distance,1),'old_gps_time_s':round(observed,6),'new_estimate_s':round(estimate,6),'new_gap_s':round(t['straight_core_gap_s'],6),'old_implied_kmh':round(distance/observed*3.6,2),'speed_equivalent_kmh':round(distance/estimate*3.6,2),'windows':t['straight_core_window_evidence']})
print(json.dumps({'gp':gp,'method':result['methodology_version'],'rows':sorted(rows,key=lambda r:r['new_gap_s'])}))
