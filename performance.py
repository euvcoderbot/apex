"""Request-scoped car comparisons. No persisted or cross-request data cache.

Keep measurements separate from interpretations: timing-line gaps are not
continuous traffic measurements, and observed corner speed is not downforce.
"""
from collections import defaultdict
from statistics import median
import math

DRY_COMPOUNDS = {'SOFT', 'MEDIUM', 'HARD', 'HYPERSOFT', 'ULTRASOFT',
                 'SUPERSOFT', 'SUPERHARD'}


def number(value):
    try:
        value = value.total_seconds() if hasattr(value, 'total_seconds') else float(value)
        return value if math.isfinite(value) else None
    except (TypeError, ValueError):
        return None


def slope(points):
    if len(points) < 6 or max(x for x, _ in points) - min(x for x, _ in points) < 5:
        return None
    # Theil–Sen is resistant to individual slow laps. Limit pairs deterministically.
    return median((b[1]-a[1])/(b[0]-a[0]) for i, a in enumerate(points)
                  for b in points[i+1:] if b[0] != a[0])


def clean(lap):
    return (lap['time'] is not None and lap['time'] > 0 and lap['accurate']
            and not lap['pit'] and not lap['deleted'] and lap['track'] == '1'
            and lap['compound'] in DRY_COMPOUNDS
            and lap.get('rain') is False)


def records(data):
    import pandas as pd
    phases = {}
    if data.name in getattr(data, '_QUALI_LIKE_SESSIONS', ()):
        for index, laps in enumerate(data.laps.split_qualifying_sessions(), 1):
            if laps is not None:
                phases.update({i: f'Q{index}' for i in laps.index})
    weather = data.weather_data
    weather_times = weather['Time'].dt.total_seconds().to_numpy() if len(weather) else []
    rows = []
    for index, row in data.laps.iterrows():
        start, end = number(row.get('LapStartTime')), number(row.get('Time'))
        rain = None
        if len(weather_times) and start is not None:
            nearest = min(range(len(weather_times)), key=lambda i: abs(weather_times[i]-start))
            if abs(weather_times[nearest]-start) <= 120:
                val = weather.iloc[nearest].get('Rainfall')
                rain = bool(val) if pd.notna(val) else None
        rows.append({'driver': str(row.get('Driver')), 'number': str(row.get('DriverNumber')),
                     'team': str(row.get('Team')), 'lap': number(row.get('LapNumber')),
                     'time': number(row.get('LapTime')), 'start': start, 'end': end,
                     'compound': str(row.get('Compound')), 'age': number(row.get('TyreLife')),
                     'stint': number(row.get('Stint')), 'phase': phases.get(index),
                     'pit': pd.notna(row.get('PitInTime')) or pd.notna(row.get('PitOutTime')),
                     'accurate': row.get('IsAccurate') is True or str(row.get('IsAccurate')) == 'True',
                     'deleted': str(row.get('Deleted')) == 'True', 'track': str(row.get('TrackStatus')),
                     'rain': rain,
                     'sectors': [number(row.get(f'Sector{i}Time')) for i in (1, 2, 3)]})
    return rows


def traffic_gaps(rows):
    """Conservative start/end timing-line gap proxy, including lapped cars.

    Find the preceding crossing irrespective of lap number; require both ends
    above threshold. This still cannot certify traffic throughout the lap.
    """
    from bisect import bisect_left
    crossings = sorted((r['end'], r['driver']) for r in rows if r['end'] is not None)
    times = [x[0] for x in crossings]
    gaps = {}
    for row in rows:
        values = []
        for stamp in (row['start'], row['end']):
            if stamp is None:
                break
            i = bisect_left(times, stamp)-1
            while i >= 0 and crossings[i][1] == row['driver']:
                i -= 1
            if i < 0:
                break
            gap = stamp-times[i]
            # No nearby crossing can also mean missing timing, not clean air.
            if gap > max(60, (row.get('time') or 0)*1.25):
                break
            values.append(gap)
        gaps[(row['driver'], row['lap'])] = min(values) if len(values) == 2 else None
    return gaps


def race_estimates(valid):
    """Robust driver effects with shared race-lap, compound and tyre-age terms.

    Exact age matching can disconnect the leaders from the midfield. Shared
    nuisance terms allow different pit strategies without equating raw lap
    times. Reject unidentified driver contrasts instead of picking a component.
    """
    import numpy as np
    from collections import Counter
    counts = Counter(r['driver'] for r in valid if r['age'] is not None)
    drivers = sorted(d for d, n in counts.items() if n >= 10)
    selected = [r for r in valid if r['driver'] in drivers and r['age'] is not None]
    if len(drivers) < 3:
        return {}, {}
    laps = sorted({r['lap'] for r in selected})
    compounds = sorted({r['compound'] for r in selected})
    matrix = np.array([
        [float(r['driver'] == d) for d in drivers]
        + [float(r['lap'] == lap) for lap in laps[1:]]
        + [float(r['compound'] == c) for c in compounds[1:]]
        + [r['age']/10 if r['compound'] == c else 0 for c in compounds]
        for r in selected])
    target = np.log([r['time'] for r in selected])*100
    # A common unidentifiable intercept is harmless; driver contrasts must be
    # identifiable. This also handles age == race lap on single-stint fixtures.
    _, singular, vt = np.linalg.svd(matrix, full_matrices=matrix.shape[0] < matrix.shape[1])
    rank = int(np.sum(singular > singular[0]*1e-10))
    null = vt[rank:]
    if len(null) and np.max(np.abs(null[:, :len(drivers)]-null[:, :1])) > 1e-6:
        return {}, {}
    weights = np.ones(len(selected))
    for _ in range(12):
        root = np.sqrt(weights)
        solution = np.linalg.lstsq(matrix*root[:, None], target*root, rcond=None)[0]
        residual = target-matrix@solution
        scale = max(.05, 1.4826*float(np.median(np.abs(residual-np.median(residual)))))
        weights = np.minimum(1, 1.5*scale/np.maximum(np.abs(residual), 1e-9))
    base = min(solution[:len(drivers)])
    estimates = {d: float(np.expm1((v-base)/100)*100)
                 for d, v in zip(drivers, solution)}
    support = {d: {'samples': counts[d], 'residual_spread': float(np.median(
        np.abs(residual[[r['driver'] == d for r in selected]])))} for d in drivers}
    return estimates, support


def analyze(data, traffic=2):
    rows = records(data)
    qualifying = data.name in getattr(data, '_QUALI_LIKE_SESSIONS', ())
    teams = defaultdict(lambda: {'drivers': [], 'points': 0, 'points_known': True,
                                  'starts': 0, 'finishes': 0, 'mechanical': 0,
                                  'incidents': 0, 'other_retirements': 0, 'positions': []})
    mechanical = {'Engine', 'Gearbox', 'Transmission', 'Hydraulics', 'Electrical',
                  'Oil pressure', 'Water pressure', 'Water leak', 'Fuel pressure',
                  'Fuel pump', 'Power Unit', 'Turbo', 'Brakes', 'Suspension',
                  'Overheating', 'Exhaust', 'Clutch', 'Driveshaft', 'Differential'}
    for code in data.drivers:
        info = data.get_driver(code)
        team = teams[str(info.get('TeamName'))]
        team['drivers'].append(str(info.get('Abbreviation')))
        team['color'] = '#' + str(info.get('TeamColor') or '888888').lstrip('#')
        status = str(info.get('Status'))
        points = number(info.get('Points'))
        team['points_known'] &= points is not None
        team['points'] += points or 0
        if status not in ('Did not start', 'Withdrew', 'Did not qualify'):
            team['starts'] += 1
        if status in ('Finished', 'Lapped') or status.startswith('+'):
            team['finishes'] += 1
        elif status in mechanical:
            team['mechanical'] += 1
        elif status in ('Accident', 'Collision', 'Collision damage', 'Spun off'):
            team['incidents'] += 1
        elif status not in ('Did not start', 'Withdrew', 'Did not qualify'):
            team['other_retirements'] += 1
        pos = number(info.get('Position'))
        if pos:
            team['positions'].append(pos)
    if qualifying:
        # The official phase classification is the authority here. Historical
        # archives often omit IsAccurate/TrackStatus in Q1/Q2 even though the
        # classification and all three sectors are complete.
        valid = [r for r in rows if r['time'] and not r['pit'] and not r['deleted']
                 and r['compound'] in DRY_COMPOUNDS and r['rain'] is False
                 and r['track'] in ('', '1') and all(r['sectors'])]
        selected = defaultdict(list)
        for phase in ('Q1', 'Q2', 'Q3'):
            official = {}
            for code in data.drivers:
                info = data.get_driver(code)
                official[str(info.get('Abbreviation'))] = number(info.get(phase))
            phase_laps = [r for r in valid if r['phase'] == phase
                          and official.get(r['driver']) is not None
                          and abs(r['time']-official[r['driver']]) < .005]
            best = min((r['time'] for r in phase_laps), default=None)
            sector_best = [min((r['sectors'][i] for r in phase_laps if r['sectors'][i]), default=None)
                           for i in range(3)]
            for name in teams:
                laps = [r for r in phase_laps if r['team'] == name]
                lap = min(laps, key=lambda r: r['time'], default=None)
                if lap and best:
                    selected[name].append({
                        'phase': phase, 'lap': lap,
                        'pace': (lap['time']/best-1)*100,
                        'sectors': [(lap['sectors'][i]/sector_best[i]-1)*100
                                    if lap['sectors'][i] and sector_best[i] else None for i in range(3)]
                    })
        for name, team in teams.items():
            phases = selected[name]
            laps = [entry['lap'] for entry in phases]
            team.update({
                'pace': sum(entry['pace'] for entry in phases)/len(phases) if phases else None,
                'lap': min(laps, key=lambda r: r['time'], default=None),
                'laps': laps,
                'telemetry_candidates': sorted(
                    [r for r in valid if r['team'] == name and laps
                     and r['time'] <= min(x['time'] for x in laps)*1.01],
                    key=lambda r: r['time'])[:3],
                'phase_count': len(phases),
                'samples': len(phases),
                'sector_deficits': [
                    (sum(values)/len(values) if values else None)
                    for values in ([entry['sectors'][i] for entry in phases
                                    if entry['sectors'][i] is not None] for i in range(3))
                ],
            })
    else:
        valid = [r for r in rows if clean(r)]
        gaps = traffic_gaps(rows)
        candidates = [r for r in valid if r['lap'] and r['lap'] > 2]
        valid = [r for r in candidates if gaps.get((r['driver'], r['lap'])) is not None
                 and gaps[(r['driver'], r['lap'])] > traffic]
        driver_team = {r['driver']: r['team'] for r in valid}
        driver_estimates, support = race_estimates(valid)
        for name, team in teams.items():
            drivers = [(driver, pace) for driver, pace in driver_estimates.items()
                       if driver_team.get(driver) == name]
            fastest = min(drivers, key=lambda item: item[1], default=None)
            team['pace'] = fastest[1] if fastest else None
            team['fastest_race_driver'] = fastest[0] if fastest else None
            team['samples'] = support[fastest[0]]['samples'] if fastest else 0
            team['race_residual_spread'] = support[fastest[0]]['residual_spread'] if fastest else None
            team['race_drivers'] = [{'driver': driver, 'pace': pace, **support[driver]}
                                    for driver, pace in drivers]
            eligible = [r for r in candidates if r['driver'] == fastest[0]] if fastest else []
            clean_laps = [r for r in valid if r['team'] == name]
            selected_clean = [r for r in clean_laps if fastest and r['driver'] == fastest[0]]
            team['traffic_coverage'] = len(selected_clean)/len(eligible) if eligible else 0
            stints = defaultdict(list)
            for r in clean_laps:
                if r['age'] is not None:
                    stints[(r['driver'], r['stint'], r['compound'])].append((r['age'], r['time']))
            team['degradation'] = [{'driver': key[0], 'stint': key[1], 'compound': key[2],
                                    'slope': slope(points), 'samples': len(points)}
                                   for key, points in stints.items() if slope(points) is not None]
    return {'event': str(data.event['EventName']), 'session': data.name,
            'teams': [{'team': name, **team} for name, team in teams.items()],
            'method': 'car-performance-v3', 'traffic_threshold': traffic,
            'total_laps': len(rows), 'eligible_laps': len(valid)}


def telemetry_metrics(samples, corners):
    """Observed corner windows and brake zones; no invented aero coefficients."""
    import numpy as np
    rows = [r for r in samples if all(number(r.get(k)) is not None for k in ('Distance', 'Speed', 'ElapsedSeconds'))]
    if len(rows) < 40:
        raise ValueError('Too few telemetry samples for a reliable comparison')
    distance = np.array([r['Distance'] for r in rows], dtype=float)
    times = np.array([r['ElapsedSeconds'] for r in rows], dtype=float)
    speed = np.array([r['Speed'] for r in rows], dtype=float)
    if np.any(np.diff(distance) <= 0) or np.any(np.diff(times) <= 0) or max(np.diff(times)) > 3:
        raise ValueError('Telemetry has gaps or invalid distance/time samples')
    length = float(distance[-1])
    positions = [(i, r) for i, r in enumerate(rows) if number(r.get('X')) is not None and number(r.get('Y')) is not None]
    located = []
    for c in corners:
        if not positions or number(c.get('x')) is None or number(c.get('y')) is None:
            continue
        index, point = min(positions, key=lambda p: (p[1]['X']-c['x'])**2+(p[1]['Y']-c['y'])**2)
        if (point['X']-c['x'])**2+(point['Y']-c['y'])**2 > 1500**2:
            continue
        located.append((float(distance[index]), str(c['number'])+str(c.get('letter') or '')))
    located.sort()
    output = []
    for i, (center, label) in enumerate(located):
        start = max(0, center-100, (located[i-1][0]+center)/2 if i else 0)
        end = min(length, center+100, (located[i+1][0]+center)/2 if i+1 < len(located) else length)
        mask = (distance >= start) & (distance <= end)
        if mask.sum() < 4 or end-start < 25 or max(np.diff(times[mask]), default=0) > 1.5:
            continue
        duration = float(np.interp(end, distance, times)-np.interp(start, distance, times))
        output.append({'corner': label, 'time': duration, 'length': end-start,
                       'minimum': float(speed[mask].min()), 'mean_speed': (end-start)/duration*3.6})
    zones, active = [], None
    for i, row in enumerate(rows):
        if i and times[i]-times[i-1] > 1.5:
            active = None
            continue
        braking = bool(row.get('Brake'))
        if braking and active is None:
            active = i
        if active is not None and (not braking or i == len(rows)-1):
            a, b = active, i
            duration = float(times[b]-times[a])
            drop = float(speed[a]-speed[b])
            if duration >= .5 and drop >= 40:
                zones.append({'start': float(distance[a]), 'distance': float(distance[b]-distance[a]),
                              'entry': float(speed[a]), 'exit': float(speed[b]),
                              'duration': duration, 'mean_g': drop/3.6/duration/9.80665})
            active = None
    full = [float(r['Speed']) for r in rows if number(r.get('Throttle')) is not None and r['Throttle'] >= 98 and not r.get('Brake')]
    return {'corners': output, 'braking': zones, 'top_speed': float(speed.max()),
            'full_throttle_p95': float(np.percentile(full, 95)) if len(full) >= 10 else None,
            'samples': len(rows), 'median_sample_interval': float(np.median(np.diff(times))),
            'lap_distance': length}
