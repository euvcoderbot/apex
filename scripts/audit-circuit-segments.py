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
    'entry': 'turn-in off the brake: inside the official corner, or at most 100 m before braking',
    'apex': 'within 15% of the corner minimum speed: the grip-limited part',
    'exit': 'after the apex until the field is back at 98% throttle (at most 150 m past the corner)',
    'flat_corner': 'lateral load >= 1.5 g with the field at >= 95% throttle and no speed minimum',
    'bend': 'an official turn taken without a speed minimum and not flat out',
    'straight': 'between official corners, field >= 98% throttle and lateral load < 1.0 g',
    'straight_lift': 'between official corners but off full throttle: lift-and-coast or energy management',
    'other': 'none of the above (part throttle on a gentle bend)',
}
MIN_PROMINENCE_KMH = 10.
# Official corners (F1 / MultiViewer turn numbers) bound every approach: a
# corner's approach never starts before the previous official turn has ended,
# and lifting on a straight is not corner entry. 2026 cars peak mid-straight
# and then clip, hundreds of metres before the brakes (Shanghai T14).
BEND_KAPPA = 1/700.     # 1/m: a tighter radius than this is a bend, not a straight
MARKER_REACH_M = 150.   # an official marker this close to the centreline belongs to it
ENTRY_REACH_M = 100.    # off-brake approach counted as entry before braking or turn-in
EXIT_REACH_M = 150.     # exit ends at full throttle or this far past the corner


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


# FIA event names for OpenF1 locations (data/fia-circuit-maps, scripts/fetch-fia-circuit-maps.py).
FIA_EVENTS = {
    'Melbourne': 'Australian Grand Prix', 'Shanghai': 'Chinese Grand Prix', 'Suzuka': 'Japanese Grand Prix',
    'Sakhir': 'Bahrain Grand Prix', 'Kuala Lumpur': 'Bahrain Grand Prix', 'Jeddah': 'Saudi Arabian Grand Prix',
    'Miami Gardens': 'Miami Grand Prix', 'Miami': 'Miami Grand Prix', 'Montréal': 'Canadian Grand Prix',
    'Monaco': 'Monaco Grand Prix', 'Monte Carlo': 'Monaco Grand Prix', 'Madrid': 'Spanish Grand Prix',
    'Barcelona': 'Barcelona-Catalunya Grand Prix', 'Spielberg': 'Austrian Grand Prix', 'Silverstone': 'British Grand Prix',
    'Spa-Francorchamps': 'Belgian Grand Prix', 'Budapest': 'Hungarian Grand Prix', 'Zandvoort': 'Dutch Grand Prix',
    'Monza': 'Italian Grand Prix', 'Baku': 'Azerbaijan Grand Prix', 'Marina Bay': 'Singapore Grand Prix',
    'Austin': 'United States Grand Prix', 'Mexico City': 'Mexico City Grand Prix', 'São Paulo': 'São Paulo Grand Prix',
    'Las Vegas': 'Las Vegas Grand Prix', 'Lusail': 'Qatar Grand Prix', 'Yas Island': 'Abu Dhabi Grand Prix',
    'Yas Marina': 'Abu Dhabi Grand Prix', 'Imola': 'Emilia Romagna Grand Prix'}
# 2025 Barcelona was the Spanish GP; from 2026 the Spanish GP is Madrid.
FIA_EVENTS_BY_YEAR = {(2025, 'Barcelona'): 'Spanish Grand Prix'}
AWS_BANDS = (125., 175.)   # F1 / AWS Insights: slow below 125 km/h, fast above 175 km/h


def fia_reference(year, location):
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'fia-circuit-maps', f'{year}.json')
    try:
        circuits = json.load(open(path, encoding='utf-8'))['circuits']
    except (OSError, ValueError):
        return None
    event = FIA_EVENTS_BY_YEAR.get((year, location)) or FIA_EVENTS.get(location)
    return next((c for c in circuits if c['event'] == event), None)


def validate(reference, grid, cls, official, events, length_m):
    """How our classification agrees with what the FIA publishes for the track."""
    out = {'event': reference['event'], 'source': reference['source']}
    official_m = reference.get('centreline_m')
    ratio = length_m/official_m if official_m else 1.
    if official_m:
        out['length_error_pct'] = (length_m/official_m-1)*100
    marker = {o['turn']: o for o in official}
    ends = {e.get('turn'): e for e in events if e.get('turn')}

    def position(p):
        """FIA "Xm after Tn" on our centreline (scaled to the official length)."""
        o = marker.get(p['turn'])
        if not o:
            return None
        if p.get('at') == 'exit':
            base = ends[p['turn']]['end_m'] if p['turn'] in ends else grid[o['hi']]
            return base
        if p.get('at') == 'entry':
            return grid[o['lo']]
        return grid[o['marker']]+p['offset_m']*ratio

    straightish = np.isin(cls, ['straight', 'straight_lift', 'flat_corner'])
    zones = []
    for z in reference.get('zones') or []:
        start = position(z)
        if start is None:
            continue
        start %= grid[-1]
        ahead = [grid[o['marker']] for o in official if grid[o['marker']] > start] or [grid[official[0]['marker']]+grid[-1]] if official else []
        end = (ahead[0] if ahead else start+300)-150*ratio
        if end <= start:
            continue
        cells = (np.arange(int(start//STEP), int(end//STEP)) % len(grid))
        zones.append({'activation': f"{z['offset_m']:+d} m T{z['turn']}" if not z.get('at') else f"{z['at']} T{z['turn']}",
                      'from_m': float(start), 'length_m': float(end-start),
                      'straight_share': float(straightish[cells].mean()),
                      'classes': {c: float(np.mean(cls[cells] == c)) for c in sorted(set(cls[cells]))}})
    out['zones'] = zones
    if zones:
        metres = sum(z['length_m'] for z in zones)
        out['zone_straight_share'] = sum(z['straight_share']*z['length_m'] for z in zones)/metres
    if reference.get('speed_trap') and (at := position(reference['speed_trap'])) is not None:
        k = int((at % grid[-1])//STEP)
        out['speed_trap'] = {'at_m': float(at % grid[-1]), 'class': str(cls[min(k, len(cls)-1)])}
    # Band changes under F1 / AWS thresholds against ours (120 / 200 km/h).
    ours = lambda v: 'low' if v <= 120 else 'medium' if v <= 200 else 'high'
    aws = lambda v: 'low' if v < AWS_BANDS[0] else 'high' if v > AWS_BANDS[1] else 'medium'
    out['band_changes_aws'] = [{'turn': e.get('turn'), 'apex_kmh': e['apex_kmh'], 'ours': ours(e['apex_kmh']), 'aws': aws(e['apex_kmh'])}
                               for e in events if ours(e['apex_kmh']) != aws(e['apex_kmh'])]
    return out


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
    # The reference lap sets the centreline. A lap whose telemetry has a gap is
    # short (Suzuka 2026: 7.5% under the FIA length), so use the lap whose
    # distance is the median of the field's, not simply the fastest.
    distances = sorted((a['d'][-1]-a['d'][0], k) for k, (_, a) in enumerate(laps))
    ref = laps[distances[len(distances)//2][1]][1]
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
    bend = np.abs(kappa) >= BEND_KAPPA
    markers = turn_markers(data['year'], data['gp'])
    # Official turns on the centreline, each with the bend it sits in.
    official = []
    for label, mx, my in markers:
        dist = np.hypot(x-mx, y-my)*scale
        k = int(np.argmin(dist))
        if dist[k] > MARKER_REACH_M:
            continue
        reach = int(MARKER_REACH_M/STEP)
        near = [j for j in range(max(0, k-reach), min(len(grid), k+reach+1)) if bend[j]]
        if near:
            k = min(near, key=lambda j: abs(j-k))
        lo = hi = k
        while lo > 0 and bend[lo-1]:
            lo -= 1
        while hi < len(grid)-1 and bend[hi+1]:
            hi += 1
        official.append({'turn': label, 'marker': k, 'lo': lo, 'hi': hi})
    official.sort(key=lambda o: o['marker'])
    cls = np.full(len(grid), 'other', dtype=object)
    cls[(thr >= 98) & (lat < 1.)] = 'straight'
    # Off full throttle with little load, outside every official corner: a
    # lift, coast or energy-management stretch of a straight (2026 cars ease
    # off on gently curving straights such as Spa T15-T16).
    in_corner = np.zeros(len(grid), bool)
    for o in official:
        in_corner[o['lo']:o['hi']+1] = True
    cls[(cls == 'other') & ~in_corner & (lat < 1.)] = 'straight_lift'
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
        own = next((o for o in official if o['lo'] <= i <= o['hi']), None) \
            or min((o for o in official if abs(o['marker']-i) <= int(MARKER_REACH_M/STEP)), key=lambda o: abs(o['marker']-i), default=None)
        # Approach starts at the last speed peak before the apex, but never
        # before the previous official turn has ended.
        start = prev_apex+int(np.argmax(v[prev_apex:i+1]))
        before = [o['hi'] for o in official if o['hi'] < (own['lo'] if own else i) and not (o['lo'] <= i <= o['hi'])]
        if before:
            start = max(start, min(max(before)+1, i))
        # Exit ends when the field is back at full throttle, and at most
        # EXIT_REACH_M past the corner.
        limit = min(next_apex, (own['hi'] if own else i)+int(EXIT_REACH_M/STEP))
        end = i
        while end < limit and thr[end] < 98:
            end += 1
        braking_at = next((j for j in range(start, i) if brk[j] >= .5), None)
        turn_in = own['lo'] if own else i
        entry_from = min(turn_in, braking_at if braking_at is not None else i)-int(ENTRY_REACH_M/STEP)
        band_lo = v[i]*1.15
        for j in range(start, end+1):
            if j < i:
                if v[j] <= band_lo:
                    cls[j] = 'apex'
                elif brk[j] >= .5:
                    cls[j] = 'braking'
                elif j >= entry_from and (own and own['lo'] <= j or thr[j] < 98):
                    # Before the corner only a lift counts as entry: where
                    # the field is still flat out it is still on the straight.
                    cls[j] = 'entry'
                # else: a lift or clip on the straight keeps its straight class
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
    # An official turn with no speed minimum: a flat-out kink stays part of
    # the straight, a flat-out bend under load stays a flat-out bend, the rest
    # is a bend taken without a minimum (not entry to the next corner).
    for o in official:
        if any(o['lo'] <= a <= o['hi'] for a in apexes):
            continue
        for j in range(o['lo'], o['hi']+1):
            if cls[j] in ('other', 'straight_lift'):
                cls[j] = 'bend'
    straights = []
    on_straight = np.isin(cls, ['straight', 'straight_lift'])
    i = 0
    while i < len(grid):
        if on_straight[i]:
            j = i
            while j < len(grid) and on_straight[j]:
                j += 1
            straights.append([i, j])
            i = j
        else:
            i += 1
    # The main straight crosses the timing line: one straight, not two.
    if len(straights) > 1 and straights[0][0] == 0 and straights[-1][1] == len(grid):
        tail = straights.pop()
        straights[0] = [tail[0], straights[0][1], tail[1]]
    runs, straights = straights, []
    for run in runs:
        i, j = run[0], run[1]
        cells = list(range(i, j)) if len(run) == 2 else list(range(i, run[2]))+list(range(0, j))
        length = len(cells)*STEP
        if length < 100:
            continue
        # Named by the official turns either side, as F1 names a straight.
        after = [o['turn'] for o in official if o['marker'] < i]
        ahead = [o['turn'] for o in official if o['marker'] >= j]
        straights.append({'start_m': float(grid[i]), 'end_m': float(grid[j-1]), 'length_m': float(length),
                          'from_turn': after[-1] if after else (official[-1]['turn'] if official else None),
                          'to_turn': ahead[0] if ahead else (official[0]['turn'] if official else None),
                          'off_throttle_m': float(np.sum(cls[cells] == 'straight_lift')*STEP),
                          'entry_kmh': float(v[i]), 'exit_kmh': float(v[j-1])})
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
    reference = fia_reference(data['year'], data['gp'])
    check = validate(reference, grid, cls, official, events, float(grid[-1])) if reference and official else None
    return {'year': data['year'], 'gp': data['gp'], 'laps': len(fields['v']), 'length_m': float(grid[-1]), 'fia': check,
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
    checked = [c['fia'] for c in out['circuits'] if c.get('fia')]
    zoned = [f for f in checked if 'zone_straight_share' in f]
    if checked:
        lengths = [abs(f['length_error_pct']) for f in checked if 'length_error_pct' in f]
        print(f"FIA check: {len(checked)} circuits · length error median {np.median(lengths):.2f}% max {max(lengths):.2f}%"
              + (f" · official straights classed straight {np.mean([f['zone_straight_share'] for f in zoned])*100:.1f}%" if zoned else '')
              + f" · speed trap on a straight {sum(f.get('speed_trap', {}).get('class') in ('straight', 'straight_lift', 'flat_corner') for f in checked)}/{sum('speed_trap' in f for f in checked)}")
    json.dump(out, open(sys.argv[2], 'w'))
