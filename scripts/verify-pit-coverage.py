"""Compare live stationary timing with the published DHL event table."""
import json,sys,requests
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server
base='https://apex-telemetry-api.vercel.app'
for gp,date in [('Singapore Grand Prix','2026-10-11'),('Bahrain Grand Prix','2026-10-04'),('Azerbaijan Grand Prix','2026-09-26')]:
    r=requests.get(base+'/api/performance/pits',params={'year':2026,'gp':gp},timeout=55)
    r.raise_for_status();data=r.json()
    stops=server.dhl_2026_pit_stops({'date_start':date})
    visits=data['visits']
    keys=[(v['driver_number'],v['lap']) for v in visits]
    assert len(keys)==len(set(keys)), 'Duplicate visits'
    timed=[v for v in visits if v['stop_duration'] is not None]
    published={(server._pit_name(s['last_name']),s['lap']):s['stop_duration'] for s in stops}
    entrants=data.get('entrants',[])
    # The public source match is additionally checked by the exact API driver
    # identity and published lap, not by a guessed neighbouring pit lap.
    session=requests.get(base+'/api/session',params={'year':2026,'gp':gp,'session':'R'},timeout=55)
    session.raise_for_status()
    names={str(d['number']):server._pit_name(d['name'].split()[-1]) for d in session.json()['drivers']}
    for v in timed:
        if v.get('visit_evidence')=='DHL stationary timing':
            assert abs(published[(names[v['driver_number']],v['lap'])]-v['stop_duration'])<1e-9
        assert v['lane_duration'] is None or v['stop_duration']<=v['lane_duration']+1
    if stops and not timed:raise AssertionError(gp+': published stationary timings lost')
    print(json.dumps({'gp':gp,'source':data['source'],'visits':len(visits),'stationary':len(timed),
                     'published':len(stops),'teams_timed':len({v['team'] for v in timed}),
                     'drivers_timed':len({v['driver'] for v in timed}),
                     'fastest':min((v['stop_duration'] for v in timed),default=None)}),flush=True)
