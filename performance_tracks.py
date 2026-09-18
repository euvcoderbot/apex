"""Field-aligned qualifying measurements, computed only inside a request."""
from collections import defaultdict
import math
import numpy as np


def prepare(samples, selection):
    a = np.array([[r.get('Distance'), r.get('ElapsedSeconds'), r.get('Speed'),
                   r.get('Throttle'), float(bool(r.get('Brake'))),
                   r.get('X'), r.get('Y')] for r in samples], dtype=float)
    official = float(selection.get('time') or selection['end']-selection['start'])
    if len(a) < 100 or not np.isfinite(a[:, :5]).all():
        raise ValueError('Incomplete speed, throttle or time channels')
    if (np.any(np.diff(a[:, 0]) <= 0) or np.any(np.diff(a[:, 1]) <= 0)
            or np.max(np.diff(a[:, 1])) > 1.5 or np.min(a[:, 2]) < 30):
        raise ValueError('Gaps or invalid speed/distance in the qualifying lap')
    if abs(a[-1, 1]-a[0, 1]-official) > 1.5:
        raise ValueError('Telemetry does not cover the official lap')
    gps = np.isfinite(a[:, 5:]).all(axis=1)
    if np.mean(gps) < .65:
        raise ValueError('Insufficient position coverage for shared track windows')
    return {'a': a, 'gps': gps, 'official': official, 'selection': selection}


def align(item, reference, grid):
    a, ref = item['a'], reference['a']
    rp = ref[reference['gps']]
    # Project each GPS sample onto nearby reference segments. The progress
    # bound prevents hairpins/crossovers snapping to another part of the lap.
    begin, vector = rp[:-1, 5:7], np.diff(rp[:, 5:7], axis=0)
    length2 = np.sum(vector*vector, axis=1)
    anchors, source = [], []
    for row in a[item['gps']]:
        fraction = row[0]/a[-1, 0]
        nearby = np.where(np.abs(rp[:-1, 0]/ref[-1, 0]-fraction) < .045)[0]
        if not len(nearby):
            continue
        v = vector[nearby]
        t = np.clip(np.sum((row[5:7]-begin[nearby])*v, axis=1)/np.maximum(length2[nearby], 1), 0, 1)
        delta = begin[nearby]+v*t[:, None]-row[5:7]
        best = int(np.argmin(np.sum(delta*delta, axis=1)))
        if np.linalg.norm(delta[best]) > 250:  # F1 coordinates are decimetres.
            continue
        i = nearby[best]
        position = rp[i, 0]+t[best]*(rp[i+1, 0]-rp[i, 0])
        if anchors and position <= anchors[-1]:
            continue
        source.append(row[0]); anchors.append(position)
    if len(anchors) < len(a)*.35 or anchors[0] > 100 or grid[-1]-anchors[-1] > 100:
        raise ValueError('Position alignment does not cover the complete lap')
    aligned = np.interp(a[:, 0], [0, *source, a[-1, 0]], [0, *anchors, grid[-1]])
    speed = np.interp(grid, aligned, a[:, 2])
    throttle = np.interp(grid, aligned, a[:, 3])
    brake = np.interp(grid, aligned, a[:, 4]) >= .5
    raw_time = np.diff(grid)*3.6*(1/speed[:-1]+1/speed[1:])/2
    factor = item['official']/raw_time.sum()
    if not .92 < factor < 1.08:
        raise ValueError('Speed integration disagrees with official lap time')
    return {**item, 'speed': speed, 'throttle': throttle, 'brake': brake,
            'dt': raw_time*factor, 'scale': float(factor), 'aligned': aligned}


def frozen(item, field):
    a, aligned = item['a'], item['aligned']
    start = 0
    for end in range(1, len(a)+1):
        if end < len(a) and a[end, 2] == a[start, 2]:
            continue
        if end-start >= 5 and a[end-1, 1]-a[start, 1] >= 1.5:
            lo, hi = aligned[start], aligned[end-1]
            mask = (field['grid'] >= lo) & (field['grid'] <= hi)
            if mask.sum() > 3 and np.ptp(field['speed'][mask]) > 18:
                return True
        start = end
    return False


def measure_field(extracted, selections, corners=()):
    """One best validated lap per team; common geometry and complete partitions.

    candidates are attempted in lap-time order, all within 1% of team best.
    No interpolated repair is used to rescue a frozen telemetry lap.
    """
    choices, errors = defaultdict(list), {}
    lookup = {s['team']: s for s in selections}
    expected = {s.get('team_name', s['team']) for s in selections}
    for key, samples, error in extracted:
        s = lookup[key]; team = s.get('team_name', key)
        try:
            if error:
                raise ValueError(error)
            choices[team].append(prepare(samples, s))
        except (ValueError, TypeError) as exc:
            errors[team] = str(exc)
    for values in choices.values():
        values.sort(key=lambda r: r['official'])
    minimum = max(3, math.ceil(len(expected)*.7))
    if len(choices) < minimum:
        return {'teams': {}, 'error': 'Too few teams have complete qualifying telemetry', 'excluded': errors}
    reference = min((v[0] for v in choices.values()), key=lambda r: r['official'])
    grid = np.linspace(0, reference['a'][-1, 0], int(reference['a'][-1, 0]/5)+1)
    aligned = defaultdict(list)
    for team, values in choices.items():
        for item in values:
            try:
                aligned[team].append(align(item, reference, grid))
            except ValueError as exc:
                errors[team] = str(exc)
    selected = {team: values[0] for team, values in aligned.items() if values}
    if len(selected) < minimum:
        return {'teams': {}, 'error': 'Too few teams pass complete-lap GPS alignment', 'excluded': errors}
    field_speed = np.median([v['speed'] for v in selected.values()], axis=0)
    scales = [v['scale'] for v in selected.values()]
    scale_mid = float(np.median(scales))
    scale_limit = max(.012, 4*float(np.median(np.abs(np.array(scales)-scale_mid))))
    for team in list(selected):
        good = [v for v in aligned[team] if abs(v['scale']-scale_mid) <= scale_limit
                and not frozen(v, {'grid': grid, 'speed': field_speed})]
        if good:
            selected[team] = good[0]
        else:
            del selected[team]
            errors[team] = 'Frozen speed or abnormal speed-to-lap-time agreement'
    if len(selected) < minimum:
        return {'teams': {}, 'error': 'Too few teams pass full-lap telemetry quality checks', 'excluded': errors}
    speed = np.median([v['speed'] for v in selected.values()], axis=0)
    throttle = np.median([v['throttle'] for v in selected.values()], axis=0)
    brake = np.mean([v['brake'] for v in selected.values()], axis=0) >= .35
    # Detect field-wide slowdowns, so an approximate map marker cannot turn a
    # straight into a high-speed corner. Flat-out bends remain straight mileage.
    smooth = np.convolve(np.pad(speed, (2, 2), mode='edge'), np.ones(5)/5, mode='valid')
    candidates = [i for i in range(5, len(grid)-5)
                  if smooth[i] <= min(smooth[i-4:i]) and smooth[i] < min(smooth[i+1:i+5])]
    apexes = []
    radius = max(1, int(200/(grid[1]-grid[0])))
    for i in sorted(candidates, key=lambda i: smooth[i]):
        left, right = max(0, i-radius), min(len(grid), i+radius)
        prominence = min(max(smooth[left:i+1]), max(smooth[i:right]))-smooth[i]
        if prominence < 12 or min(throttle[left:right]) > 97:
            continue
        if all(abs(grid[i]-grid[j]) >= 100 for j in apexes):
            apexes.append(i)
    apexes.sort()
    zones = []
    for k, apex in enumerate(apexes):
        left = (apexes[k-1]+apex)//2 if k else 0
        right = (apex+apexes[k+1])//2 if k+1 < len(apexes) else len(grid)-1
        start = apex
        while start > left and (speed[start] < speed[apex]+60 or throttle[start] < 98 or brake[start]):
            start -= 1
        # Include the beginning of braking, even when it precedes the speed dip.
        while start > left and brake[start-1]:
            start -= 1
        end = apex
        while end < right and (throttle[end] < 98 or speed[end] < speed[apex]+30):
            end += 1
        if grid[end]-grid[start] < 40:
            continue
        label = f'Zone {len(zones)+1}'
        valid_ref = reference['a'][reference['gps']]
        xy = [np.interp(grid[apex], valid_ref[:, 0], valid_ref[:, j]) for j in (5, 6)]
        mapped = [c for c in corners if c.get('x') is not None and c.get('y') is not None]
        if mapped:
            marker = min(mapped, key=lambda c: (c['x']-xy[0])**2+(c['y']-xy[1])**2)
            if math.hypot(marker['x']-xy[0], marker['y']-xy[1]) < 1000:
                label = str(marker['number'])+str(marker.get('letter') or '')
        if any(z['corner'] == label for z in zones):
            label = f'{label} · zone {len(zones)+1}'
        zones.append({'start': start, 'end': end, 'apex': apex, 'corner': label,
                      'band': 'low' if speed[apex] <= 120 else 'medium' if speed[apex] <= 200 else 'high'})
    if len(zones) < 3:
        return {'teams': {}, 'error': 'Too few reliable braking/corner zones', 'excluded': errors}
    corner_mask = np.zeros(len(grid)-1, dtype=bool)
    for zone in zones:
        corner_mask[zone['start']:zone['end']] = True
    reference_team = min(selected, key=lambda team: selected[team]['official'])
    ref = selected[reference_team]
    results = {}
    for team, item in selected.items():
        measurements = []
        for z in zones:
            a, b, apex = z['start'], z['end'], z['apex']
            dt = float(item['dt'][a:b].sum())
            measurements.append({'corner': z['corner'], 'band': z['band'], 'time': dt,
                'length': float(grid[b]-grid[a]), 'minimum': float(min(item['speed'][a:b+1])),
                'mean_speed': float((grid[b]-grid[a])/dt*3.6),
                'apex_distance': float(grid[apex])})
        categories = {}
        for band in ('low', 'medium', 'high'):
            indices = [i for i,z in enumerate(zones) if z['band'] == band]
            if not indices:
                categories[band] = None; continue
            scores = []
            for i in indices:
                z = zones[i]; a,b = z['start'],z['end']
                times = [v['dt'][a:b].sum() for v in selected.values()]
                # Identical distance means mean-speed ratios equal inverse time
                # ratios. Score each corner before averaging the band.
                scores.append(measurements[i]['time']/min(times))
            categories[band] = {'score': float(np.mean(scores)), 'corners': len(indices),
                'speed': float(np.mean([measurements[i]['mean_speed'] for i in indices]))}
        straight_time = float(item['dt'][~corner_mask].sum())
        corner_time = float(item['dt'][corner_mask].sum())
        braking = []
        for z in zones:
            indices = np.where(item['brake'][z['start']:z['apex']+1])[0]+z['start']
            if len(indices) < 2:
                continue
            a, b = int(indices[0]), int(indices[-1])+1
            duration = float(item['dt'][a:b].sum())
            drop = float(item['speed'][a]-item['speed'][b])
            if duration >= .5 and drop >= 40:
                braking.append({'start': float(grid[a]), 'distance': float(grid[b]-grid[a]),
                    'duration': duration, 'mean_g': drop/3.6/duration/9.80665})
        results[team] = {'corners': measurements, 'categories': categories,
            'straight_time': straight_time, 'corner_time': corner_time,
            'straight_contribution': float((straight_time-ref['dt'][~corner_mask].sum())/ref['official']*100),
            'corner_contribution': float((corner_time-ref['dt'][corner_mask].sum())/ref['official']*100),
            'lap_gap': (item['official']/ref['official']-1)*100,
            'top_speed': float(max(item['speed'])),
            'full_throttle_p95': float(np.percentile(item['speed'][item['throttle'] >= 98],95)) if np.sum(item['throttle'] >= 98) >= 10 else None,
            'lap_distance': float(grid[-1]), 'braking': braking, 'selection': item['selection'],
            'quality': {'integration_scale': item['scale'], 'full_lap': True}}
    best_straight = min(r['straight_time'] for r in results.values())
    for r in results.values():
        r['straight_deficit'] = (r['straight_time']/best_straight-1)*100
    for band in ('low','medium','high'):
        best = min((r['categories'][band]['score'] for r in results.values() if r['categories'][band]),default=None)
        for r in results.values():
            if r['categories'][band]:
                r['categories'][band]['deficit'] = (r['categories'][band]['score']/best-1)*100
    return {'teams': results, 'reference_team': reference_team, 'excluded': {t:e for t,e in errors.items() if t not in results},
            'method': 'shared-gps-grid-v1', 'corner_count': len(zones)}
