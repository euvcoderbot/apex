"""Classify every 5 m of each circuit from field telemetry: what is a corner,
what is a braking zone, what is a straight.

usage: audit-circuit-segments.py <laps_dir> <out.json>
<laps_dir> holds capture-openf1-qualifying.py output (one file per session).

Each lap is registered to a shared centreline by GPS projection (not by lap
distance fraction, which drifts tens of metres between cars). Classes come
from the field median at each position, so one car's line does not decide
what the circuit is. Thresholds are listed in CLASS_RULES and in the output.
"""
import sys, os, glob, gzip, json, math
from collections import defaultdict
import numpy as np

STEP = 5.
G = 9.80665
CLASS_RULES = {
    'braking': 'approach to a corner apex with at least half the field on the brake',
    'entry': 'approach to a corner apex off the brake (lift / coast / trail release)',
    'apex': 'within 15% of the corner minimum speed: the grip-limited part',
    'exit': 'after the apex until the field is back at 98% throttle',
    'flat_corner': 'lateral load >= 1.5 g with the field at >= 95% throttle and no speed minimum',
    'straight': 'field >= 98% throttle and lateral load < 1.0 g',
    'other': 'none of the above (part throttle on a gentle bend, energy-management lift)',
}
MIN_PROMINENCE_KMH = 10.


def centreline(a):
    """Smoothed XY of the reference lap on a 5 m grid of its own distance."""
    d = a['d']-a['d'][0]
    grid = np.arange(0., d[-1], STEP)
    x, y = np.interp(grid, d, a['x']), np.interp(grid, d, a['y'])
    k = np.ones(9)/9
    for _ in range(2):
        x = np.convolve(np.pad(x, 4, mode='edge'), k, mode='valid')
        y = np.convolve(np.pad(y, 4, mode='edge'), k, mode='valid')
    scale = d[-1]/np.sum(np.hypot(np.diff(x), np.diff(y)))  # metres per position unit
    return grid, x, y, scale


def curvature(grid, x, y):
    i = np.arange(len(grid))
    r = int(20/STEP)
    left, right = np.maximum(0, i-r), np.minimum(len(grid)-1, i+r)
    heading = np.unwrap(np.arctan2(y[right]-y[left], x[right]-x[left]))
    c = (heading[right]-heading[left])/np.maximum(STEP, grid[right]-grid[left])
    return np.convolve(np.pad(c, 4, mode='edge'), np.ones(9)/9, mode='valid')


def project(lap, grid, x, y, scale):
    """Centreline distance of every packet, by nearest centreline point within
    a progress window (prevents snapping across hairpins/crossovers)."""
    frac = (lap['d']-lap['d'][0])/(lap['d'][-1]-lap['d'][0])
    out = np.full(len(frac), np.nan)
    pts = np.column_stack([x, y])
    for j, f in enumerate(frac):
        centre = int(f*len(grid))
        lo, hi = max(0, centre-60), min(len(grid), centre+60)
        dist = np.hypot(pts[lo:hi, 0]-lap['x'][j], pts[lo:hi, 1]-lap['y'][j])*scale
        k = int(np.argmin(dist))
        if dist[k] < 40:
            out[j] = grid[lo+k]
    good = np.isfinite(out)
    # Enforce forward progress; drop packets that would reverse.
    keep = good.copy()
    last = -1.
    for j in np.flatnonzero(good):
        if out[j] < last:
            keep[j] = False
        else:
            last = out[j]
    return out, keep


def turn_markers(year, location):
    """Official turn numbers and positions (MultiViewer), or [] when offline."""
    try:
        import urllib.request, urllib.parse
        from fastf1.mvapi import get_circuit_info
        q = urllib.parse.urlencode({'year': year, 'session_name': 'Qualifying'})
        sessions = json.load(urllib.request.urlopen('https://api.openf1.org/v1/sessions?'+q, timeout=60))
        key = next(x['circuit_key'] for x in sessions if x['location'] == location)
        info = get_circuit_info(year=year, circuit_key=key)
        return [(str(r.Number)+str(r.Letter or ''), float(r.X), float(r.Y)) for r in info.corners.itertuples()]
    except Exception:
        return []


def audit(path):
    data = json.load(gzip.open(path, 'rt'))
    laps = []
    for l in data['laps']:
        s = l['samples']
        a = {k: np.asarray(s[k], float) for k in ('t', 'd', 'v', 'thr', 'brk', 'x', 'y', 'drs')}
        if len(a['t']) < 100 or a['v'].min() < 30:
            continue
        laps.append((l, a))
    if len(laps) < 6:
        return None
    fastest = min(l['time'] for l, _ in laps)
    laps = [(l, a) for l, a in laps if l['time'] <= fastest*1.03]
    ref = min(laps, key=lambda r: r[0]['time'])[1]
    grid, x, y, scale = centreline(ref)
    kappa = curvature(grid, x, y)
    fields = defaultdict(list)
    for l, a in laps:
        pos, keep = project(a, grid, x, y, scale)
        if keep.mean() < .8:
            continue
        p = pos[keep]
        for key in ('v', 'thr', 'brk'):
            fields[key].append(np.interp(grid, p, a[key][keep]))
    v = np.median(fields['v'], axis=0)
    thr = np.median(fields['thr'], axis=0)
    brk = np.mean(np.array(fields['brk']) >= .5, axis=0)
    lat = (v/3.6)**2*np.abs(kappa)/G
    cls = np.full(len(grid), 'other', dtype=object)
    cls[(thr >= 98) & (lat < 1.)] = 'straight'
    cls[(lat >= 1.5) & (thr >= 95)] = 'flat_corner'
    # Corners are minima of the field's speed: that is where grip, not power,
    # sets the pace. Prominence against the fastest point within 300 m.
    r = int(300/STEP)
    apexes = []
    for i in range(1, len(grid)-1):
        lo, hi = max(0, i-r), min(len(grid), i+r+1)
        if v[i] > v[max(0, i-int(60/STEP)):min(len(grid), i+int(60/STEP)+1)].min():
            continue
        if min(v[lo:i+1].max(), v[i:hi].max())-v[i] < MIN_PROMINENCE_KMH:
            continue
        if apexes and grid[i]-grid[apexes[-1]] < 60:
            if v[i] < v[apexes[-1]]:
                apexes[-1] = i
            continue
        apexes.append(i)
    events = []
    for n, i in enumerate(apexes):
        prev_apex = apexes[n-1] if n else 0
        next_apex = apexes[n+1] if n+1 < len(apexes) else len(grid)-1
        # Approach starts at the last speed peak before the apex.
        start = prev_apex+int(np.argmax(v[prev_apex:i+1]))
        # Exit ends when the field is back at full throttle.
        end = i
        while end < next_apex and thr[end] < 98:
            end += 1
        band_lo = v[i]*1.15
        for j in range(start, end+1):
            if j < i:
                cls[j] = 'apex' if v[j] <= band_lo else 'braking' if brk[j] >= .5 else 'entry'
            else:
                cls[j] = 'apex' if v[j] <= band_lo else 'exit'
        events.append({'apex_m': float(grid[i]), 'start_m': float(grid[start]), 'end_m': float(grid[end]),
                       'apex_kmh': float(v[i]), 'entry_kmh': float(v[start]),
                       'peak_lat_g': float(lat[max(start, i-8):min(end, i+8)+1].max()),
                       'apex_throttle': float(thr[i]), 'braked': bool((brk[start:i+1] >= .5).any()),
                       'braking_m': float(np.sum(brk[start:i+1] >= .5)*STEP),
                       'band': 'low' if v[i] <= 120 else 'medium' if v[i] <= 200 else 'high',
                       'xy': [float(x[i]), float(y[i])]})
    flats = []
    i = 0
    while i < len(grid):
        if cls[i] == 'flat_corner':
            j = i
            while j < len(grid) and cls[j] == 'flat_corner':
                j += 1
            if grid[j-1]-grid[i] >= 20:
                flats.append({'start_m': float(grid[i]), 'end_m': float(grid[j-1]), 'min_kmh': float(v[i:j].min()),
                              'peak_lat_g': float(lat[i:j].max()), 'xy': [float(x[(i+j)//2]), float(y[(i+j)//2])]})
            i = j
        else:
            i += 1
    straights = []
    i = 0
    while i < len(grid):
        if cls[i] == 'straight':
            j = i
            while j < len(grid) and cls[j] == 'straight':
                j += 1
            if grid[j-1]-grid[i] >= 100:
                straights.append({'start_m': float(grid[i]), 'end_m': float(grid[j-1]), 'length_m': float(grid[j-1]-grid[i]),
                                  'entry_kmh': float(v[i]), 'exit_kmh': float(v[j-1])})
            i = j
        else:
            i += 1
    markers = turn_markers(data['year'], data['gp'])
    for e in events:
        if markers:
            label, mx, my = min(markers, key=lambda m: (m[1]-e['xy'][0])**2+(m[2]-e['xy'][1])**2)
            e['turn'] = label if math.hypot(mx-e['xy'][0], my-e['xy'][1])*scale <= 150 else None
    # Full-throttle running, and how much of it loses speed (energy clipping).
    full = (thr >= 98) & (brk < .5)
    dvds = np.gradient(v, grid)
    energy = {'full_throttle_share': float(full.mean()),
              'fading_at_full_throttle_share': float((full & (dvds < -.02)).mean())}
    share = {c: float(np.mean(cls == c)) for c in CLASS_RULES}
    drs_known = any(np.isin(a['drs'], [10, 12, 14]).any() for _, a in laps)
    step = max(1, len(grid)//400)
    return {'year': data['year'], 'gp': data['gp'], 'laps': len(fields['v']), 'length_m': float(grid[-1]),
            'drs_channel': drs_known, 'distance_share': share, 'energy': energy,
            'markers': [{'turn': m[0], 'x': m[1], 'y': m[2]} for m in markers], 'corners': events, 'flat_corners': flats,
            'straights': straights,
            'trace': {'x': x[::step].round(1).tolist(), 'y': y[::step].round(1).tolist(), 'class': cls[::step].tolist(),
                      'v': v[::step].round(1).tolist(), 'd': grid[::step].tolist()}}


if __name__ == '__main__':
    out = {'rules': CLASS_RULES, 'circuits': []}
    for path in sorted(glob.glob(os.path.join(sys.argv[1], '*.json.gz'))):
        result = audit(path)
        if result:
            out['circuits'].append(result)
            sh = result['distance_share']
            print(f"{result['year']} {result['gp']:18} corners {len(result['corners']):2} (L/M/H "
                  f"{sum(c['band']=='low' for c in result['corners'])}/{sum(c['band']=='medium' for c in result['corners'])}/{sum(c['band']=='high' for c in result['corners'])})"
                  f" flat {len(result['flat_corners']):2} straights {len(result['straights']):2} | "
                  + ' '.join(f"{k} {v*100:4.1f}%" for k, v in sh.items()))
    json.dump(out, open(sys.argv[2], 'w'))
