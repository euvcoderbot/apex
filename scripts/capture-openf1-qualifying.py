"""Each driver's best 2 qualifying laps from OpenF1: native car data + location."""
import sys, json, gzip, os, time, urllib.request, urllib.parse
from datetime import datetime, timezone, timedelta
import numpy as np
# usage: capture-openf1-qualifying.py <out_dir> [year ...]
# With years, every finished qualifying of those seasons; without, the original set.
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
def get(path, **q):
    url = 'https://api.openf1.org/v1/' + path + '?' + urllib.parse.urlencode(q, safe='<>=:')
    for attempt in range(10):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                time.sleep(.6); return json.load(r)
        except Exception as e:
            if getattr(e, 'code', None) == 404: return []
            retry = getattr(e, 'headers', None) and e.headers.get('Retry-After')
            time.sleep(float(retry) if retry else min(60, 5*(attempt+1)))
    raise RuntimeError('failed ' + url)
def ts(s): return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()
ALL = {2025: ['Suzuka', 'Sakhir', 'Monaco', 'Silverstone', 'Budapest', 'Monza', 'Las Vegas', 'Yas Marina', 'Zandvoort', 'Mexico City'],
       2026: ['Melbourne', 'Shanghai', 'Suzuka', 'Sakhir', 'Miami Gardens', 'Monte Carlo', 'Barcelona', 'Silverstone', 'Spa-Francorchamps', 'Budapest', 'Monza', 'Baku', 'Marina Bay']}
WANT = {int(y): [] for y in sys.argv[2:]} or ALL
for year, wanted in WANT.items():
    # Cancelled sessions stay listed with no data (2026: Bahrain and Saudi Arabia in April).
    sessions = [s for s in get('sessions', year=year, session_name='Qualifying')
                if ts(s['date_end']) < time.time() - 86400 and not s.get('is_cancelled')]
    if wanted: sessions = [s for s in sessions if s['location'] in wanted]
    for s in sessions:
        path = os.path.join(out, f"{year}-{s['location'].replace(' ', '_')}.json.gz")
        if os.path.exists(path): continue
        try:
            key = s['session_key']
            drivers = {d['driver_number']: d for d in get('drivers', session_key=key)}
            laps = [l for l in get('laps', session_key=key) if l.get('lap_duration') and l.get('date_start') and not l.get('is_pit_out_lap')]
            rows = []
            for num, d in drivers.items():
                own = sorted((l for l in laps if l['driver_number'] == num), key=lambda l: l['lap_duration'])[:2]
                for lap in own:
                    t0 = ts(lap['date_start']); t1 = t0 + lap['lap_duration']
                    lo = datetime.fromtimestamp(t0 - 1, timezone.utc).isoformat(); hi = datetime.fromtimestamp(t1 + 1, timezone.utc).isoformat()
                    try:
                        car = get('car_data', session_key=key, driver_number=num, **{'date>': lo, 'date<': hi})
                        loc = get('location', session_key=key, driver_number=num, **{'date>': lo, 'date<': hi})
                    except RuntimeError as e:
                        print('skip lap', num, e, flush=True); continue
                    if len(car) < 100 or len(loc) < 50: continue
                    ct = np.array([ts(c['date']) for c in car]); lt = np.array([ts(c['date']) for c in loc])
                    keep = (ct >= t0) & (ct <= t1); ct = ct[keep]; car = [c for c, k in zip(car, keep) if k]
                    v = np.array([c['speed'] for c in car], float)
                    dist = np.r_[0, np.cumsum(np.diff(ct) * (v[1:] + v[:-1]) / 2 / 3.6)]
                    rows.append({'driver': d.get('name_acronym'), 'number': str(num), 'team': d.get('team_name'),
                                 'lap': lap['lap_number'], 'time': lap['lap_duration'], 'speed_st': lap.get('st_speed'),
                                 'samples': {'t': (ct - t0).tolist(), 'd': dist.tolist(), 'v': v.tolist(),
                                             'thr': [c['throttle'] for c in car], 'brk': [float(c['brake'] >= 50) for c in car],
                                             'drs': [c.get('drs') or 0 for c in car],
                                             'x': np.interp(ct, lt, [p['x'] for p in loc]).tolist(), 'y': np.interp(ct, lt, [p['y'] for p in loc]).tolist()}})
            with gzip.open(path, 'wt') as f: json.dump({'year': year, 'gp': s['location'], 'laps': rows}, f)
            print('ok', year, s['location'], len(rows), flush=True)
        except Exception as e: print('FAIL', year, s['location'], e, flush=True)
