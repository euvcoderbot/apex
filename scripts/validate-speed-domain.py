"""Old (measure_field) vs new (car_physics) on real qualifying laps.

Primary test: teammate agreement. A car-performance metric should be shared by
the two drivers of the same car, so after removing the circuit (within-GP rank
normalisation) teammates' values should correlate. Noise-dominated metrics give
~0. This needs no assumption about which team should be fastest.
"""
import sys, os, glob, gzip, json, math, time, urllib.request, urllib.parse, warnings
from collections import defaultdict
from statistics import NormalDist
import numpy as np
sys.path.insert(0, sys.argv[1]); warnings.filterwarnings('ignore')
from performance_tracks import measure_field
from car_physics import speed_domain_metrics
data_dir, out_path = sys.argv[2], sys.argv[3]
laps_per_car = int(sys.argv[4]) if len(sys.argv) > 4 else 1
only_new = len(sys.argv) > 5 and sys.argv[5] == 'new-only'


def openf1(path, **q):
    url = 'https://api.openf1.org/v1/'+path+'?'+urllib.parse.urlencode(q)
    for i in range(5):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                time.sleep(.4)
                return json.load(r)
        except Exception:
            time.sleep(3+3*i)
    return []


sector_cache, corner_cache = {}, {}
def corners_for(year, gp):
    sectors(year, gp)
    return corner_cache.get((year, gp), [])
def sectors(year, gp):
    if (year, gp) not in sector_cache:
        s = [x for x in openf1('sessions', year=year, session_name='Qualifying') if x['location'] == gp]
        laps = openf1('laps', session_key=s[0]['session_key']) if s else []
        try:
            from fastf1.mvapi import get_circuit_info
            info = get_circuit_info(year=year, circuit_key=s[0]['circuit_key'])
            corner_cache[(year, gp)] = [{'number': str(r.Number), 'letter': str(r.Letter or ''), 'x': float(r.X), 'y': float(r.Y)}
                                        for r in info.corners.itertuples()]
        except Exception as e:
            print('no corners', gp, e)
        sector_cache[(year, gp)] = {(str(l['driver_number']), l['lap_number']):
                                    [l.get('duration_sector_1'), l.get('duration_sector_2'), l.get('duration_sector_3')] for l in laps}
    return sector_cache[(year, gp)]


def arrays(lap):
    s = lap['samples']
    return np.column_stack([s['d'], s['t'], s['v'], s['thr'], s['brk'], s['x'], s['y'], s['drs']]).astype(float)


def old_metrics(laps, sec, corners):
    best = {}
    for lap in laps:
        if lap['driver'] not in best or lap['time'] < best[lap['driver']]['time']:
            best[lap['driver']] = lap
    extracted, selections = [], []
    for drv, lap in best.items():
        s = lap['samples']
        samples = [{'Distance': d, 'ElapsedSeconds': t, 'Speed': v, 'Throttle': th, 'Brake': b, 'X': x, 'Y': y, 'DRS': dr}
                   for d, t, v, th, b, x, y, dr in zip(s['d'], s['t'], s['v'], s['thr'], s['brk'], s['x'], s['y'], s['drs'])]
        sc = sec.get((lap['number'], lap['lap']))
        extracted.append((drv, samples, None))
        selections.append({'team': drv, 'team_name': drv, 'driver': drv, 'driver_number': lap['number'], 'lap': lap['lap'],
                           'time': lap['time'], 'start': 0., 'end': lap['time'], 'qualifying_best_time': lap['time'],
                           'qualifying_best_driver': drv, 'qualifying_best_lap': lap['lap'],
                           'sectors': sc if sc and all(sc) else None})
    r = measure_field(extracted, selections, corners)
    out = defaultdict(dict)
    zone_durations = defaultdict(dict)
    for drv, t in r.get('teams', {}).items():
        for band in ('low', 'medium', 'high'):
            c = (t.get('categories') or {}).get(band)
            out[drv]['corner_'+band] = c['deficit'] if c else None
        out[drv]['straight'] = t.get('straight_core_delta')
        for z in t.get('braking') or []:
            zone_durations[z['corner']][drv] = z['duration']
    # Frontend "slowing" score: mean per-zone gap to the quickest in that zone.
    for zone, values in zone_durations.items():
        if len(values) < 3:
            continue
        m = min(values.values())
        for drv, v in values.items():
            out[drv].setdefault('_brk', []).append(v-m)
    for drv in out:
        g = out[drv].pop('_brk', None)
        out[drv]['braking'] = float(np.mean(g)) if g else None
    return dict(out)


def new_metrics(laps, corners):
    cars = defaultdict(list)
    for lap in sorted(laps, key=lambda l: l['time']):
        if len(cars[lap['driver']]) < laps_per_car:
            cars[lap['driver']].append(arrays(lap))
    r = speed_domain_metrics(cars, corners)
    out = {}
    for drv, row in r['cars'].items():
        g = lambda k: row.get(k) and row[k].get('index')
        c = row.get('cornering') or {}
        # Orient everything so that larger = worse, like the old deficits.
        out[drv] = {'corner_'+b: (c[b]['time_vs_median_s'] if c.get(b) and c[b].get('index') is not None else None)
                    for b in ('low', 'medium', 'high')}
        out[drv].update({k: g(k) for k in ('straight', 'straight_mid', 'straight_top', 'traction', 'braking')})
        out[drv]['energy'] = row.get('energy', {}).get('fade_kmh')
    return out, r.get('corner_method'), r.get('corner_count'), r


def normal_scores(values):
    names = sorted(values, key=values.get)
    n = len(names)
    return {nm: NormalDist().inv_cdf((i+.5)/n) for i, nm in enumerate(names)}


results = {'old': defaultdict(list), 'new': defaultdict(list)}
coverage = {'old': defaultdict(lambda: [0, 0]), 'new': defaultdict(lambda: [0, 0])}
laptime_corr = {'old': defaultdict(list), 'new': defaultdict(list)}
per_gp, raw = [], {}
for path in sorted(glob.glob(os.path.join(data_dir, '*.json.gz'))):
    data = json.load(gzip.open(path, 'rt'))
    laps, year, gp = data['laps'], data['year'], data['gp']
    if not laps:
        continue
    team_of = {l['driver']: l['team'] for l in laps}
    best_time = defaultdict(lambda: 1e9)
    for l in laps:
        best_time[l['driver']] = min(best_time[l['driver']], l['time'])
    old = {}
    if not only_new:
        try:
            old = old_metrics(laps, sectors(year, gp), corners_for(year, gp))
        except Exception as e:
            print('old failed', gp, repr(e))
    try:
        new, cm, cc, full = new_metrics(laps, corners_for(year, gp))
        raw[f'{year} {gp}'] = {'teams': team_of, 'best_time': dict(best_time), 'new': new, 'old': old}
    except Exception as e:
        new, cm, cc = {}, None, 0
        print('new failed', gp, repr(e))
    per_gp.append({'year': year, 'gp': gp, 'drivers': len(best_time), 'old_drivers': len(old),
                   'new_drivers': len(new), 'corner_method': cm, 'corners': cc})
    for label, metrics in (('old', old), ('new', new)):
        keys = {k for m in metrics.values() for k in m}
        for key in keys:
            vals = {d: m[key] for d, m in metrics.items() if m.get(key) is not None and math.isfinite(m[key])}
            coverage[label][(year, key)][0] += len(vals)
            coverage[label][(year, key)][1] += len(best_time)
            if len(vals) < 6:
                continue
            z = normal_scores(vals)
            teams = defaultdict(list)
            for d in z:
                teams[team_of[d]].append(z[d])
            for pair in teams.values():
                if len(pair) == 2:
                    results[label][(year, key)].append(tuple(pair))
            lt = normal_scores({d: best_time[d] for d in vals})
            laptime_corr[label][(year, key)].append(float(np.corrcoef([z[d] for d in vals], [lt[d] for d in vals])[0, 1]))
    print('done', year, gp, 'old', len(old), 'new', len(new), cm, cc, flush=True)


def icc(pairs):
    if len(pairs) < 8:
        return None
    a = np.array(pairs)
    return float(np.corrcoef(np.r_[a[:, 0], a[:, 1]], np.r_[a[:, 1], a[:, 0]])[0, 1])


def boot(pairs, n=2000, seed=1):
    if len(pairs) < 8:
        return None
    rng = np.random.default_rng(seed)
    a = np.array(pairs)
    vals = []
    for _ in range(n):
        s = a[rng.integers(0, len(a), len(a))]
        vals.append(np.corrcoef(np.r_[s[:, 0], s[:, 1]], np.r_[s[:, 1], s[:, 0]])[0, 1])
    return [float(np.percentile(vals, 5)), float(np.percentile(vals, 95))]


summary = []
for label in ('old', 'new'):
    for (year, key), pairs in sorted(results[label].items()):
        cov = coverage[label][(year, key)]
        lt = laptime_corr[label][(year, key)]
        summary.append({'method': label, 'year': year, 'metric': key, 'teammate_r': icc(pairs), 'ci90': boot(pairs),
                        'pairs': len(pairs), 'coverage': cov[0]/max(1, cov[1]), 'laptime_r': float(np.mean(lt)) if lt else None})
json.dump({'summary': summary, 'per_gp': per_gp, 'laps_per_car': laps_per_car, 'raw': raw}, open(out_path, 'w'), indent=1)
fmt = lambda x: '  -  ' if x is None else f'{x:+.2f}'
for row in summary:
    ci = row['ci90'] and '[' + ', '.join(f'{c:+.2f}' for c in row['ci90']) + ']'
    print(f"{row['method']:4} {row['year']} {row['metric']:13} teammate r={fmt(row['teammate_r'])} 90%CI={ci} "
          f"pairs={row['pairs']:3} cov={row['coverage']:.0%} laptime r={fmt(row['laptime_r'])}")
