"""Speed-domain car metrics: compare cars at equal speed, not inside fixed windows.

The window-timing metrics in performance_tracks.py time each car between shared
distance (or speed) endpoints on one lap. That is sensitive to three things that
are not car performance:

* entry speed: a car that exits the previous corner faster is quicker through
  every later window, so straights and corners absorb each other's gains;
* registration: a few metres of GPS/distance misalignment moves tens of
  milliseconds between neighbouring windows, comparable to real car gaps;
* sampling: one ~4 Hz lap gives only a handful of packets per braking zone.

This module instead estimates each car's capability *as a function of speed*
from every eligible packet on its supplied laps, and only then compares cars
over the same speed range:

* straight line: full-throttle acceleration a(v) per aero (DRS) state, then
  the time each car's curve needs over the same simulated straight (same
  entry speed, same length). Split at 250 km/h because 2026 power units are
  energy-limited (deployment taper / clipping) at the top end;
* traction: exit acceleration a(v) at any throttle once the car has gained
  30 km/h over its own apex, simulated the same way;
* braking: mean deceleration over the straight-line phase of each brake
  application, fitted as decel = c0 + c2 v^2, compared as distance to shed
  the same speed;
* cornering: minimum speed at each grip-limited corner, converted to lateral
  grip. Cars take the same corner radius, so lateral acceleration scales with
  v^2 and the apex-speed ratio squared is a grip ratio. A local minimum is
  also insensitive to small distance-registration errors.

Results are still delivered performance (car + driver + setup + energy
deployment), not isolated drag, horsepower or brake hardware.
"""
import math
import numpy as np

G = 9.80665
METHOD = 'speed-domain-v1'
# Field-median apex speed thresholds, the same convention as performance_tracks.
CORNER_BANDS = (('low', 0., 120.), ('medium', 120., 200.), ('high', 200., 300.))
# Above this, a "corner" is flat out and not grip-limited for qualifying cars.
FLAT_OUT_KMH = 300.
# ...or where the median car stays at or above this throttle through the apex.
FLAT_THROTTLE = 95.
# A car's speed minimum must lie within this distance of the corner's track point.
APEX_MATCH_M = 70.
# Dwell near the apex: time within this fraction above the apex speed.
DWELL_MARGIN = .15
# Laps slower than this multiple of the car's own best are not flying laps...
MAX_LAP_RATIO = 1.03
# ...nor laps outside the 107% rule.
SESSION_LAP_RATIO = 1.07
# Longitudinal speed ranges (km/h). Traction is wheelspin-limited out of slow
# corners; the straight-line range is power/drag (and energy deployment).
TRACTION_RANGE = (70., 170.)
EXIT_PHASE_KMH = 30.
# Split of the straight-line range. Above ~250 km/h 2026 cars are commonly
# energy-limited (deployment taper / clipping), so the top end reflects energy
# management as much as drag or engine power; keep it separately visible.
STRAIGHT_MID_RANGE = (160., 250.)
STRAIGHT_TOP_RANGE = (250., 360.)
MIN_WEIGHT_COVERAGE = .6
# From docs/speed-domain-methodology-20261020.md: teammate agreement after
# removing overall lap time, 21 qualifying sessions (2025 + 2026). Traction
# fails in 2025 (too few slow exits with clean samples); show it as evidence.
RELIABILITY = {'straight': 'established', 'straight_mid': 'moderate', 'straight_top': 'established',
               'energy': 'established', 'cornering': 'moderate', 'braking': 'moderate', 'traction': 'low'}
# Columns of performance_tracks.prepare()['a'].
D, T, V, THR, BRK, X, Y, DRS = range(8)


def _lap(a):
    a = np.asarray(a, dtype=float)
    keep = np.isfinite(a[:, [D, T, V, THR, BRK]]).all(axis=1)
    a = a[keep]
    order = np.argsort(a[:, T], kind='stable')
    a = a[order]
    a = a[np.r_[True, np.diff(a[:, T]) > 0]]
    if len(a) < 40:
        raise ValueError('Too few native samples')
    return a


def local_slope(t, y, half_window):
    """Local least-squares slope over +/- half_window seconds (uneven sampling).

    A windowed regression rather than a point difference: ~4 Hz packets with
    1 km/h quantisation make two-point differences far too noisy.
    """
    t = t - t[0]
    lo = np.searchsorted(t, t - half_window, side='left')
    hi = np.searchsorted(t, t + half_window, side='right')
    c = lambda z: np.r_[0., np.cumsum(z)]
    s1, st, sy, stt, sty = c(np.ones_like(t)), c(t), c(y), c(t*t), c(t*y)
    n = s1[hi]-s1[lo]
    sum_t, sum_y = st[hi]-st[lo], sy[hi]-sy[lo]
    sum_tt, sum_ty = stt[hi]-stt[lo], sty[hi]-sty[lo]
    denominator = n*sum_tt-sum_t**2
    with np.errstate(divide='ignore', invalid='ignore'):
        slope = (n*sum_ty-sum_t*sum_y)/denominator
    slope[(n < 3) | (denominator <= 1e-9)] = np.nan
    return slope, lo, hi


def window_all(mask, lo, hi):
    """True where every sample inside [lo, hi) satisfies mask."""
    bad = np.r_[0, np.cumsum(~mask)]
    return (bad[hi]-bad[lo]) == 0


def track_reference(a, step=5.):
    """Smoothed centreline and signed curvature of one reference lap.

    Position units differ between feeds (FastF1 uses decimetres), so the XY
    path is rescaled to the lap's integrated distance.
    """
    gps = np.isfinite(a[:, [X, Y]]).all(axis=1)
    if gps.mean() < .65:
        return None
    a = a[gps]
    length = float(a[-1, D]-a[0, D])
    grid = np.arange(0., length, step)
    x = np.interp(grid, a[:, D]-a[0, D], a[:, X])
    y = np.interp(grid, a[:, D]-a[0, D], a[:, Y])
    # Position feeds are ~4 Hz and linearly interpolated, so the raw path is
    # a polyline whose kinks read as huge curvature. Smooth over ~45 m.
    k = np.ones(9)/9
    for _ in range(2):
        x = np.convolve(np.pad(x, 4, mode='edge'), k, mode='valid')
        y = np.convolve(np.pad(y, 4, mode='edge'), k, mode='valid')
    path = float(np.sum(np.hypot(np.diff(x), np.diff(y))))
    if path <= 0:
        return None
    scale = length/path
    radius = max(2, int(20/step))
    i = np.arange(len(grid))
    left, right = np.maximum(0, i-radius), np.minimum(len(grid)-1, i+radius)
    heading = np.unwrap(np.arctan2(y[right]-y[left], x[right]-x[left]))
    curvature = (heading[right]-heading[left])/np.maximum(step, grid[right]-grid[left])
    curvature = np.convolve(np.pad(curvature, 4, mode='edge'), k, mode='valid')
    return {'grid': grid, 'length': length, 'x': x, 'y': y, 'scale': scale, 'curvature': curvature}


def speed_since_minimum(speed_kmh, braking):
    """Speed gained since the lowest point after the last brake application.

    At equal absolute speed a high-grip car may still be rotating through the
    corner on part throttle while a slower car is already exiting; requiring
    the same gain over each car's own apex puts every car in the exit phase.
    """
    gained = np.zeros(len(speed_kmh))
    low = speed_kmh[0]
    for i, v in enumerate(speed_kmh):
        low = v if braking[i] else min(low, v)
        gained[i] = v-low
    return gained


def lap_signals(a, track, pos=None):
    """Acceleration and lateral-load estimate for every packet of one lap."""
    t, v = a[:, T], a[:, V]/3.6
    accel, lo, hi = local_slope(t, v, .45)
    if pos is None and track:
        pos = (a[:, D]-a[0, D])/max(1., a[-1, D]-a[0, D])*track['length']
    curvature = np.interp(pos, track['grid'], track['curvature']) if track else np.zeros(len(a))
    lateral_g = v**2*np.abs(curvature)/G
    full = (a[:, THR] >= 98) & (a[:, BRK] < .5)
    # Out of slow corners drivers feed throttle in as grip allows (often only
    # reaching 100% near 150 km/h), so the throttle position itself is the
    # traction limit. Exit phase: on throttle, off the brake, gaining speed.
    exiting = (a[:, THR] >= 20) & (a[:, BRK] < .5) & (speed_since_minimum(a[:, V], a[:, BRK] >= .5) >= EXIT_PHASE_KMH)
    braking = a[:, BRK] >= .5
    # DRS codes 10/12/14 mean the flap is open (2018-2025). Mixing open- and
    # closed-wing packets in one curve would compare different drag states,
    # so curves are built per state. Where the feed carries no aero state
    # (2026 active aero is not published) everything is one stratum.
    drs_open = a[:, DRS] >= 10 if a.shape[1] > DRS else np.zeros(len(a), bool)
    drs_open = np.nan_to_num(drs_open).astype(bool)
    return {'speed_kmh': a[:, V], 'accel': accel, 'lateral_g': lateral_g,
            'full_throttle': window_all(full, lo, hi), 'exiting': window_all(exiting, lo, hi),
            'drs_open': window_all(drs_open, lo, hi), 'drs_closed': window_all(~drs_open, lo, hi)}


NODE_KMH = 10.
BANDWIDTH_KMH = 12.
# Top-end straight: a fixed run from 250 km/h; long enough to reach the
# speeds where 2026 deployment taper/clipping dominates.
TOP_END_DISTANCE_M = 500.


def acceleration_curve(speed_kmh, accel, lo, hi):
    """Full-throttle acceleration at fixed speed nodes (kernel local-linear).

    Comparing cars at the *same speed* is what removes entry-speed effects:
    a car that exits a corner faster must not look stronger on the straight.
    One lap has few packets per 10 km/h, so each node borrows nearby speeds
    with a Gaussian weight. A node is only reported where the car itself has
    packets close by; nothing is extrapolated beyond what it reached.
    """
    nodes = np.arange(lo+NODE_KMH/2, hi, NODE_KMH)
    curve = np.full(len(nodes), np.nan)
    for i, node in enumerate(nodes):
        if np.sum(np.abs(speed_kmh-node) <= NODE_KMH) < 2:
            continue
        w = np.exp(-.5*((speed_kmh-node)/BANDWIDTH_KMH)**2)
        if w.sum() < 3:
            continue
        X = np.column_stack([np.ones(len(w)), speed_kmh-node])
        sw = np.sqrt(w)
        beta, *_ = np.linalg.lstsq(X*sw[:, None], accel*sw, rcond=None)
        curve[i] = beta[0]
    return nodes, curve


def simulate_straight(nodes, curve, v0_kmh, distance_m, fallback, step=2.):
    """Time to cover distance_m from v0 under acceleration curve a(v).

    Interior gaps in a car's curve are interpolated; beyond its fastest
    supported node the field reference is used, shifted to meet the car's
    last value, so nothing is invented about the car's top end beyond a
    constant offset (and the result says so).
    """
    finite = np.isfinite(curve)
    known_v, known_a = nodes[finite]/3.6, curve[finite]
    ref_v, ref_a = nodes/3.6, fallback
    offset = known_a[-1]-np.interp(known_v[-1], ref_v, ref_a)
    v, t, extrapolated = v0_kmh/3.6, 0., False
    for _ in range(int(distance_m/step)):
        if v <= known_v[-1]:
            a = float(np.interp(v, known_v, known_a))
        else:
            a = float(np.interp(v, ref_v, ref_a))+offset
            extrapolated = True
        v_next = math.sqrt(max(v*v+2*a*step, (5/3.6)**2))
        t += 2*step/(v+v_next)
        v = v_next
    return t, v*3.6, extrapolated


def acceleration_index(curves, nodes, v_start, v_end=None, distance_m=None):
    """Time over the same straight for every car, relative to the median car.

    The straight starts at v_start and is as long as the median car needs to
    reach v_end (or distance_m). Simulating time over a fixed distance is
    what lap time depends on; it is also well conditioned near terminal
    speed, where comparing 1/acceleration would amplify noise without bound
    (2026 power units taper to ~0 g long before the end of a straight).
    """
    names = [n for n in curves if curves[n] is not None]
    if len(names) < 3:
        return {}, None
    stack = np.array([curves[n] for n in names])
    supported = np.sum(np.isfinite(stack), axis=0) >= max(3, math.ceil(.5*len(names)))
    if supported.sum() < 3:
        return {}, None
    reference = np.full(len(nodes), np.nan)
    reference[supported] = np.nanmedian(stack[:, supported], axis=0)
    # Fill the reference curve's own gaps so it can be a fallback everywhere.
    ok = np.isfinite(reference)
    reference = np.interp(nodes, nodes[ok], reference[ok])
    start = max(v_start, float(nodes[ok][0]-NODE_KMH/2))
    if distance_m is None:
        v, distance = start/3.6, 0.
        while v*3.6 < v_end and distance < 3000:
            a = float(np.interp(v, nodes/3.6, reference))
            if a <= .05:
                break
            v = math.sqrt(v*v+2*a*2.)
            distance += 2.
        distance_m = distance
    if distance_m < 20:
        return {}, None
    reference_time, reference_exit, _ = simulate_straight(nodes, reference, start, distance_m, reference)
    result = {}
    lower = np.searchsorted(nodes, start)
    upper = np.searchsorted(nodes, min(reference_exit, nodes[-1]+NODE_KMH/2))
    span = slice(lower, max(lower+1, upper))
    for name, curve in zip(names, stack):
        needed = supported[span]
        coverage = float(np.mean(np.isfinite(curve[span])[needed])) if needed.any() else 0.
        if coverage < MIN_WEIGHT_COVERAGE or not np.isfinite(curve).any():
            result[name] = {'index': None, 'coverage': coverage,
                            'exclusion': 'Acceleration observed over too little of the shared speed range'}
            continue
        duration, exit_kmh, extrapolated = simulate_straight(nodes, curve, start, distance_m, reference)
        result[name] = {'index': duration/reference_time, 'time_s': duration, 'gap_to_median_s': duration-reference_time,
                        'exit_kmh': exit_kmh, 'coverage': coverage, 'top_end_from_reference': extrapolated,
                        'exclusion': None}
    return result, {'start_kmh': start, 'distance_m': distance_m, 'reference_time_s': reference_time,
                    'reference_exit_kmh': reference_exit}


def speed_minima(a, prominence=6.):
    """Local speed minima of one lap: the lowest packet within +/-0.7 s that
    is at least `prominence` km/h below the highest speed in the 3 s either side."""
    t, v = a[:, T], a[:, V]
    found = []
    for i in range(1, len(v)-1):
        near = (t >= t[i]-.7) & (t <= t[i]+.7)
        if v[i] > v[near].min() or (found and found[-1] == i-1 and v[i] == v[i-1]):
            continue
        before = v[(t >= t[i]-3) & (t < t[i])]
        after = v[(t > t[i]) & (t <= t[i]+3)]
        if len(before) and len(after) and min(before.max(), after.max())-v[i] >= prominence:
            found.append(i)
    return found


def apex_dwell(a, i, margin=DWELL_MARGIN):
    """Seconds the car spends within `margin` of its apex speed around minimum i.

    Time lost to a slower apex scales with how long the car is near that
    speed: dt ~ dwell * (v_field / v_car - 1).
    """
    limit = a[i, V]*(1+margin)
    lo = hi = i
    while lo > 0 and a[lo-1, V] <= limit:
        lo -= 1
    while hi < len(a)-1 and a[hi+1, V] <= limit:
        hi += 1
    # Extend to the interpolated crossings either side.
    def crossing(j, k):
        v0, v1 = a[j, V], a[k, V]
        return a[j, T]+(limit-v0)/(v1-v0)*(a[k, T]-a[j, T]) if v1 != v0 else a[j, T]
    start = crossing(lo, lo-1) if lo > 0 else a[lo, T]
    end = crossing(hi, hi+1) if hi < len(a)-1 else a[hi, T]
    return float(max(0., end-start))


# --- shared circuit segmentation ----------------------------------------
# Validated against every 2025/2026 qualifying session in
# scripts/audit-circuit-segments.py (circuit segment audit report).
SEGMENT_STEP = 5.
CORNER_PROMINENCE_KMH = 10.
APEX_PHASE = .15            # apex phase: within 15% of the corner's minimum speed
GRIP_THROTTLE = 90.         # an unbraked minimum above this throttle is a lift / energy dip


def project_lap(a, track):
    """Centreline distance of every packet by GPS projection.

    Nearest centreline point within a progress window (no snapping across
    hairpins or crossovers), forced to move forward; packets without a fix
    are placed by the car's own integrated distance between neighbours.
    """
    grid, cx, cy, scale = track['grid'], track['x'], track['y'], track['scale']
    d = a[:, D]-a[0, D]
    frac = d/max(1., d[-1])
    pos = np.full(len(a), np.nan)
    gps = np.isfinite(a[:, [X, Y]]).all(axis=1)
    window = max(20, int(300/SEGMENT_STEP))
    for j in np.flatnonzero(gps):
        centre = int(frac[j]*len(grid))
        lo, hi = max(0, centre-window), min(len(grid), centre+window)
        dist = np.hypot(cx[lo:hi]-a[j, X], cy[lo:hi]-a[j, Y])*scale
        k = int(np.argmin(dist))
        if dist[k] < 40:
            pos[j] = grid[lo+k]
    last = -np.inf
    for j in range(len(pos)):
        if np.isfinite(pos[j]):
            if pos[j] < last:
                pos[j] = np.nan
            else:
                last = pos[j]
    good = np.isfinite(pos)
    if good.sum() < .6*len(pos):
        return None
    return np.interp(d, d[good], pos[good])


def field_segments(laps, track, markers=()):
    """Corner events and straights from the field median at each position."""
    grid = track['grid']
    v, thr, brk = [], [], []
    for a, pos in laps:
        v.append(np.interp(grid, pos, a[:, V]))
        thr.append(np.interp(grid, pos, a[:, THR]))
        brk.append(np.interp(grid, pos, a[:, BRK]) >= .5)
    v, thr, brk = np.median(v, axis=0), np.median(thr, axis=0), np.mean(brk, axis=0)
    lateral = (v/3.6)**2*np.abs(track['curvature'])/G
    radius, near = int(300/SEGMENT_STEP), int(60/SEGMENT_STEP)
    apexes = []
    for i in range(1, len(grid)-1):
        if v[i] > v[max(0, i-near):i+near+1].min():
            continue
        if min(v[max(0, i-radius):i+1].max(), v[i:i+radius+1].max())-v[i] < CORNER_PROMINENCE_KMH:
            continue
        if apexes and grid[i]-grid[apexes[-1]] < 60:
            if v[i] < v[apexes[-1]]:
                apexes[-1] = i
            continue
        apexes.append(i)
    corners = []
    for n, i in enumerate(apexes):
        previous = apexes[n-1] if n else 0
        following = apexes[n+1] if n+1 < len(apexes) else len(grid)-1
        start = previous+int(np.argmax(v[previous:i+1]))
        end = i
        while end < following and thr[end] < 98:
            end += 1
        phase = np.flatnonzero(v[start:end+1] <= v[i]*(1+APEX_PHASE))+start
        braked = bool((brk[start:i+1] >= .5).any())
        corner = {'apex_m': float(grid[i]), 'start_m': float(grid[start]), 'end_m': float(grid[end]),
                  'apex_phase_m': [float(grid[phase[0]]), float(grid[phase[-1]])],
                  'field_apex_kmh': float(v[i]), 'apex_throttle': float(thr[i]), 'braked': braked,
                  'grip_limited': braked or float(thr[i]) < GRIP_THROTTLE,
                  'band': next(b for b, lo, hi in CORNER_BANDS if lo < v[i] <= hi) if v[i] <= CORNER_BANDS[-1][2] else 'high',
                  'turn': None}
        if markers:
            label, mx, my = min(markers, key=lambda m: (m[1]-track['x'][i])**2+(m[2]-track['y'][i])**2)
            if math.hypot(mx-track['x'][i], my-track['y'][i])*track['scale'] <= 150:
                corner['turn'] = label
        corners.append(corner)
    # A fast S-bend need not produce two longitudinal speed dips. Recover each
    # mapped turn from a sustained curvature arc, bounded by neighbouring map
    # turns. Speed and curvature must both be observed; markers alone add no data.
    mapped = sorted([(int(np.argmin((track['x']-mx)**2+(track['y']-my)**2)), label)
                     for label, mx, my in markers])
    for n, (centre, label) in enumerate(mapped):
        before = (mapped[n-1][0]+centre)//2 if n else 0
        after = (centre+mapped[n+1][0])//2 if n+1 < len(mapped) else len(grid)-1
        lo, hi = max(before, centre-16), min(after, centre+16)
        if hi-lo < 6:
            continue
        curve = track['curvature'][lo:hi+1]
        speed = float(np.median(v[lo:hi+1]))
        lateral_g = (v[lo:hi+1]/3.6)**2*np.abs(curve)/G
        # Reject straight-line noise and isolated GPS kinks.
        if speed <= 200 or np.median(lateral_g) < 1.2 or abs(np.sum(curve)*SEGMENT_STEP) < .15:
            continue
        start, end = float(grid[lo]), float(grid[hi])
        # A speed-minimum corner already measures this turn over its full
        # braking-to-exit extent; the narrow curvature arc would cut its apex
        # off (Bahrain T13 read 204-250 km/h across the field). Label it only.
        nearby = [c for c in corners if start <= c['apex_m'] <= end and not c.get('mapped_fast_bend')]
        if nearby:
            for c in nearby:
                c['turn'] = c['turn'] or label
            continue
        i = min(range(lo, hi+1), key=lambda k: v[k])
        braked = bool((brk[lo:hi+1] >= .5).any())
        # A braked turn has a real speed minimum, found above when the field
        # slows; an arc around its map marker is only the braking entry (China
        # T1 read 192-309 km/h mid-braking). Never measure that as an apex.
        if braked:
            continue
        corners.append({'apex_m': float(grid[centre]), 'start_m': start, 'end_m': end,
                        'apex_phase_m': [start, end], 'field_apex_kmh': float(v[i]),
                        'apex_throttle': float(np.median(thr[lo:hi+1])),
                        'braked': braked,
                        'grip_limited': braked or bool(np.median(thr[lo:hi+1]) < GRIP_THROTTLE),
                        'mapped_fast_bend': True, 'band': 'high', 'turn': label,
                        'geometry_source': 'mapped-curvature'})
    corners.sort(key=lambda c: c['apex_m'])
    straight = (thr >= 98) & (lateral < 1.)
    straights = []
    i = 0
    while i < len(grid):
        if straight[i]:
            j = i
            while j < len(grid) and straight[j]:
                j += 1
            if grid[j-1]-grid[i] >= 100:
                straights.append((float(grid[i]), float(grid[j-1])))
            i = j
        else:
            i += 1
    exits = [(c['apex_m'], c['end_m']) for c in corners if c['grip_limited']]
    return {'corners': corners, 'straights': straights, 'exits': exits, 'field_speed': v}


def in_ranges(pos, ranges):
    mask = np.zeros(len(pos), bool)
    for lo, hi in ranges:
        mask |= (pos >= lo) & (pos <= hi)
    return mask


def car_apex(a, pos, corner):
    """This car's own speed minimum inside the corner's extent, or None."""
    inside = (pos >= corner['start_m']) & (pos <= corner['end_m'])
    candidates = [i for i in speed_minima(a) if inside[i]]
    if not candidates:
        # Fast corners can have a broad, almost constant-speed apex: requiring
        # another 6 km/h dip in every car removes valid packets at the same bend.
        # Use a fully observed local window about the field apex, and flag it.
        if corner.get('band') != 'high':
            return None
        lo = max(corner['start_m'], corner['apex_m']-35.)
        hi = min(corner['end_m'], corner['apex_m']+35.)
        ids = np.flatnonzero((pos >= lo) & (pos <= hi))
        if len(ids) < 3 or pos[ids[0]]-lo > 20 or hi-pos[ids[-1]] > 20:
            return None
        if np.max(np.diff(a[ids, T])) > .6:
            return None
        i = int(ids[np.argmin(a[ids, V])])
        method = 'bounded-apex-window'
    else:
        i = min(candidates, key=lambda j: abs(pos[j]-corner['apex_m']))
        method = 'local-speed-minimum'
    if (i and a[i, T]-a[i-1, T] > .6) or (i+1 < len(a) and a[i+1, T]-a[i, T] > .6):
        return None
    # A fast apex's 15% speed envelope can otherwise run through neighbouring
    # slow corners for 20+ seconds. Only this corner's local phase contributes.
    local_start = float(np.interp(corner['start_m'], pos, a[:, T]))
    local_end = float(np.interp(corner['end_m'], pos, a[:, T]))
    dwell = min(apex_dwell(a, i), max(0., local_end-local_start))
    return {'index': i, 'kmh': float(a[i, V]), 'pos': float(pos[i]), 'dwell': dwell,
            'method': method}


def braking_into(a, pos, corner, apex):
    """Average deceleration from brake onset to this car's own apex.

    Distances come from GPS projection over ~100-200 m, so the 4 Hz brake flag
    only matters at onset. The onset time is placed between the last off and
    first on packet from the speed already lost by that packet.
    """
    i = apex['index']
    on = np.flatnonzero((a[:i+1, BRK] >= .5) & (pos[:i+1] >= corner['start_m']))
    if not len(on):
        return None
    j = int(on[0])
    if j == 0 or a[j, T]-a[j-1, T] > .6:
        return None
    v0, v1 = a[j-1, V]/3.6, a[j, V]/3.6
    nxt = min(i, j+2)
    decel = (a[j, V]-a[nxt, V])/3.6/max(.05, a[nxt, T]-a[j, T]) if nxt > j else 0.
    lost = max(0., v0-v1)
    t_on = a[j, T]-min(a[j, T]-a[j-1, T], lost/decel) if decel > 1. else .5*(a[j-1, T]+a[j, T])
    w = (t_on-a[j-1, T])/max(1e-6, a[j, T]-a[j-1, T])
    pos_on = pos[j-1]+w*(pos[j]-pos[j-1])
    v_on = v0
    # Deceleration ends where the car first gets within 3 km/h of its apex
    # speed; the near-constant-speed arc or trail-off before the apex is
    # cornering, not braking. The crossing is interpolated between packets.
    target = apex['kmh']+3.
    k = j+int(np.flatnonzero(a[j:i+1, V] <= target)[0]) if (a[j:i+1, V] <= target).any() else i
    if k > j and a[k-1, V] != a[k, V]:
        f = (a[k-1, V]-target)/(a[k-1, V]-a[k, V])
        pos_end, v_end = pos[k-1]+f*(pos[k]-pos[k-1]), target/3.6
    else:
        pos_end, v_end = pos[k], a[k, V]/3.6
    distance = pos_end-pos_on
    if distance < 20 or v_on-v_end < 15/3.6:
        return None
    return {'entry_kmh': v_on*3.6, 'distance_m': float(distance),
            'decel': float((v_on**2-v_end**2)/(2*distance)), 'mean_v2': float((v_on**2+v_end**2)/2)}


def full_throttle_fade(a, pos, accel, straights):
    """Speed lost while flat out on the audited straights (km/h per lap).

    At full throttle a car only loses speed when deployable energy runs out
    (2026 clipping) or it is pushed past its drag-limited speed by a tow;
    either way it is not the car accelerating.
    """
    on = in_ranges(pos, straights) & (a[:, THR] >= 98) & (a[:, BRK] < .5)
    lost = 0.
    for k in range(1, len(a)):
        if on[k] and on[k-1] and a[k, T]-a[k-1, T] <= .6 and a[k, V] < a[k-1, V]:
            lost += a[k-1, V]-a[k, V]
    return float(lost)


def braking_comparison(corner_rows, names):
    """Braking at equal speed, corner by corner.

    Deceleration grows with speed (downforce and drag ~v^2), so a car that
    brakes from a higher entry speed or to a higher apex speed would look like
    a better braker. Fit the field's decel = c0 + c2 v^2 over all events, take
    each event's ratio to that curve at its own speeds, centre each corner on
    its field median, and compare cars on the median over corners.
    """
    events = [e for r in corner_rows for laps in r['braking'].values() for e in laps]
    empty = {n: {'index': None, 'exclusion': 'Too few braked corners with a clean onset'} for n in names}
    if len(events) < 12:
        return empty
    X = np.column_stack([np.ones(len(events)), [e['mean_v2'] for e in events]])
    c0, c2 = np.linalg.lstsq(X, np.array([e['decel'] for e in events]), rcond=None)[0]
    if c2 < 0:
        c0, c2 = float(np.median([e['decel'] for e in events])), 0.
    per_car = {n: [] for n in names}
    braked = 0
    for r in corner_rows:
        ratios = {n: float(np.median([e['decel']/(c0+c2*e['mean_v2']) for e in laps])) for n, laps in r['braking'].items()}
        if len(ratios) < 3:
            continue
        braked += 1
        centre = float(np.median(list(ratios.values())))
        for n, v in ratios.items():
            per_car[n].append(v/centre)
    out = {}
    for n in names:
        values = per_car[n]
        if len(values) < max(2, math.ceil(.6*braked)):
            out[n] = {'index': None, 'corners': len(values), 'expected': braked,
                      'exclusion': 'Too few braked corners with a clean onset'}
            continue
        # Distance needed scales with 1/deceleration.
        index = 1/float(np.median(values))
        out[n] = {'index': index, 'distance_vs_median_pct': 100*(index-1), 'corners': len(values),
                  'expected': braked, 'exclusion': None}
    return out


def speed_domain_metrics(cars, corners=()):
    """cars: {name: [lap_array, ...]} using prepare()['a'] columns.

    Every lap is registered to one centreline by GPS and the circuit is split
    once, from the field, into corners (with braking, apex and exit phases)
    and straights. Each category is then measured only in its own phase.
    """
    laps = {}
    for name, items in cars.items():
        valid = []
        for item in items:
            try:
                valid.append(_lap(item))
            except ValueError:
                continue
        if valid:
            laps[name] = valid
    excluded = {name: 'No usable native telemetry' for name in cars if name not in laps}
    durations = [a[-1, T]-a[0, T] for values in laps.values() for a in values]
    if durations:
        fastest = min(durations)
        # A flying lap: inside 107% of the session's fastest (the sporting
        # rule; 2026 spreads exceed 4%) and within 3% of the car's own best.
        laps = {name: kept for name, values in laps.items()
                if (kept := [a for a in values if a[-1, T]-a[0, T] <= min(fastest*SESSION_LAP_RATIO,
                             min(b[-1, T]-b[0, T] for b in values)*MAX_LAP_RATIO) and a[:, V].min() >= 30])}
        excluded.update({name: 'Lap outside 107% of the fastest, or not a flying lap' for name in cars
                         if name not in laps and name not in excluded})
    if len(laps) < 3:
        return {'method': METHOD, 'cars': {}, 'error': 'Fewer than three cars have usable telemetry'}
    reference_lap = min((lap for values in laps.values() for lap in values), key=lambda a: a[-1, T]-a[0, T])
    track = track_reference(reference_lap)
    if track is None:
        return {'method': METHOD, 'cars': {}, 'error': 'Reference lap has too little position data'}
    projected = {name: [(a, p) for a in values if (p := project_lap(a, track)) is not None] for name, values in laps.items()}
    excluded.update({name: 'Lap does not register to the circuit by GPS' for name, values in projected.items() if not values})
    projected = {name: values for name, values in projected.items() if values}
    if len(projected) < 3:
        return {'method': METHOD, 'cars': {}, 'error': 'Fewer than three cars register to the circuit by GPS'}
    markers = []
    for c in corners or ():
        if c.get('x') is None or c.get('y') is None:
            continue
        x, y = c['x'], c['y']
        if c.get('normalized'):
            x = float(np.min(track['x'])+x*np.ptp(track['x']))
            y = float(np.min(track['y'])+y*np.ptp(track['y']))
            error = np.min(np.hypot(track['x']-x, track['y']-y))*track['scale']
            if error > 150:
                continue
        markers.append((str(c['number'])+str(c.get('letter') or ''), x, y))
    segments = field_segments([lp for values in projected.values() for lp in values], track, markers)
    results = {name: {} for name in projected}
    reference_ranges = {}

    # --- straight line and traction: equal-speed acceleration ---------------
    states = ('drs_closed', 'drs_open')
    ranges = (('traction', TRACTION_RANGE), ('straight_mid', STRAIGHT_MID_RANGE), ('straight_top', STRAIGHT_TOP_RANGE))
    accel_fits = {(key, state): {} for key, _ in ranges for state in states}
    nodes, fades = {}, {}
    for name, values in projected.items():
        sig = [lap_signals(a, track, p) for a, p in values]
        cat = lambda key: np.concatenate([s_[key] for s_ in sig])
        pos = np.concatenate([p for _, p in values])
        speed, accel = cat('speed_kmh'), cat('accel')
        on_straight = cat('full_throttle') & np.isfinite(accel) & in_ranges(pos, segments['straights'])
        exiting = cat('exiting') & np.isfinite(accel) & (accel > 0) & in_ranges(pos, segments['exits'])
        for key, (lo, hi) in ranges:
            for state in states:
                chosen = (exiting if key == 'traction' else on_straight) & cat(state)
                nodes[key], accel_fits[(key, state)][name] = acceleration_curve(speed[chosen], accel[chosen], lo, hi)
        fades[name] = float(np.median([full_throttle_fade(a, p, s_['accel'], segments['straights']) for (a, p), s_ in zip(values, sig)]))
        results[name]['counts'] = {'straight_samples': int(on_straight.sum()), 'exit_samples': int(exiting.sum())}
    for key, _ in ranges:
        per_state, totals = {}, {}
        for state in states:
            lo_kmh, hi_kmh = dict(ranges)[key]
            index, info = acceleration_index(accel_fits[(key, state)], nodes[key], lo_kmh,
                                             v_end=hi_kmh if key != 'straight_top' else None,
                                             distance_m=TOP_END_DISTANCE_M if key == 'straight_top' else None)
            if info:
                per_state[state], totals[state] = index, info
        reference_ranges[key] = totals or None
        for name in projected:
            parts = [(per_state[st][name], totals[st]['reference_time_s']) for st in per_state
                     if per_state[st].get(name, {}).get('index') is not None]
            if not parts:
                seen = [per_state[st][name] for st in per_state if name in per_state[st]]
                results[name][key] = seen[0] if seen else None
                continue
            weight = sum(w for _, w in parts)
            results[name][key] = {'index': sum(p['index']*w for p, w in parts)/weight,
                                  'gap_to_median_s': sum(p['gap_to_median_s'] for p, _ in parts),
                                  'coverage': sum(p['coverage']*w for p, w in parts)/weight,
                                  'reference_time_s': weight,
                                  'aero_states': [st for st in per_state if per_state[st].get(name, {}).get('index') is not None],
                                  'exclusion': None}
    for name in projected:
        keys = [k for k in ('straight_mid', 'straight_top') if results[name].get(k) and results[name][k].get('index') is not None]
        results[name]['straight'] = ({'index': sum(results[name][k]['index']*results[name][k]['reference_time_s'] for k in keys)
                                      / sum(results[name][k]['reference_time_s'] for k in keys), 'parts': keys,
                                      'gap_to_median_s': sum(results[name][k]['gap_to_median_s'] for k in keys), 'exclusion': None}
                                     if keys else {'index': None, 'exclusion': 'No supported full-throttle straight-line range'})
        results[name]['top_speed'] = float(max(a[:, V].max() for a, _ in projected[name]))
    centre = float(np.median(list(fades.values())))
    for name, fade in fades.items():
        results[name]['energy'] = {'fade_kmh': fade, 'fade_vs_median_kmh': fade-centre, 'exclusion': None}

    # --- corners and braking, corner by corner ------------------------------
    corner_rows = []
    for corner in segments['corners']:
        # A bend the field takes flat out is limited by power and energy
        # deployment, not grip: its "apex" speed is straight-line speed
        # (Baku T18-T20 sit on the main straight). Only grip-limited corners
        # rank cornering, so the high band can be empty at a circuit.
        if not corner['grip_limited']:
            continue
        speeds, dwells, braking, apex_methods = {}, [], {}, {}
        for name, values in projected.items():
            apexes, brakes = [], []
            for a, p in values:
                apex = car_apex(a, p, corner)
                if apex:
                    apexes.append(apex)
                    if corner['braked'] and (b := braking_into(a, p, corner, apex)):
                        brakes.append(b)
            if apexes:
                speeds[name] = float(np.median([x['kmh'] for x in apexes]))
                dwells.append(float(np.median([x['dwell'] for x in apexes])))
                apex_methods[name] = sorted({x['method'] for x in apexes})
            if brakes:
                braking[name] = brakes
        if len(speeds) < max(3, math.ceil(.5*len(projected))):
            continue
        field = float(np.median(list(speeds.values())))
        corner_rows.append({**corner, 'corner': corner['turn'] or f"{corner['apex_m']:.0f} m", 'field_apex_kmh': field,
                            'band': next(b for b, lo, hi in CORNER_BANDS if lo < field <= hi) if field <= CORNER_BANDS[-1][2] else 'high',
                            'dwell_s': float(np.median(dwells)), 'speeds': speeds, 'braking': braking,
                            'apex_methods': apex_methods})
    braking_by_car = braking_comparison(corner_rows, list(projected))
    for name in projected:
        results[name]['braking'] = braking_by_car[name]
        bands = {}
        for band, _, _ in CORNER_BANDS:
            rows = [r for r in corner_rows if r['band'] == band and name in r['speeds']]
            expected = sum(r['band'] == band for r in corner_rows)
            if not expected:
                bands[band] = None
                continue
            # A circuit may have a single grip-limited corner of a type (2026
            # cars take most fast bends flat); one measured corner still counts.
            if len(rows) < max(1, math.ceil(.6*expected)):
                bands[band] = {'index': None, 'corners': len(rows), 'expected': expected,
                               'exclusion': 'Too few comparable corners in this band'}
                continue
            ratios = np.sort([r['speeds'][name]/r['field_apex_kmh'] for r in rows])
            trim = int(len(ratios)*.2)
            # Time lost to a slower apex ~ time near that speed x speed deficit.
            loss = sum(r['dwell_s']*(r['field_apex_kmh']/r['speeds'][name]-1) for r in rows)*expected/len(rows)
            bands[band] = {'index': float(np.mean(ratios[trim:len(ratios)-trim])), 'corners': len(rows),
                           'expected': expected, 'time_vs_median_s': float(loss), 'exclusion': None,
                           'provisional': any('bounded-apex-window' in r['apex_methods'].get(name, []) for r in rows)}
        results[name]['cornering'] = bands
        results[name]['corners'] = [{'corner': r['corner'], 'band': r['band'], 'apex_kmh': r['speeds'][name],
                                     'field_apex_kmh': r['field_apex_kmh'], 'apex_methods': r['apex_methods'][name]} for r in corner_rows if name in r['speeds']]
    _attach_gaps(results)
    return {'method': METHOD, 'cars': results, 'reliability': RELIABILITY, 'excluded': excluded,
            'corner_count': len(corner_rows), 'reference_ranges': reference_ranges,
            'segments': {'corners': [{k: v for k, v in c.items() if k not in ('speeds', 'braking')} for c in corner_rows],
                         'straights': segments['straights']},
            'interpretation': {
                'cornering': 'Time lost at grip-limited corners from each car\'s own apex speed and time spent near it.',
                'straight': 'Full-throttle acceleration on the audited straights, simulated over the same straight for every car.',
                'straight_mid': '160-250 km/h part of the straight-line comparison.',
                'straight_top': '250 km/h and above; shaped by energy deployment on 2026 cars.',
                'traction': 'Acceleration in the exit phase of grip-limited corners, 70-170 km/h.',
                'braking': 'Average deceleration from brake onset to the car\'s own apex, per braked corner, against the field.',
                'energy': 'Speed lost at full throttle on the straights (energy clipping on 2026 cars).'}}


def _attach_gaps(results):
    """Gaps to the best car: % for index categories, seconds for corner bands."""
    for key in ('traction', 'straight', 'straight_mid', 'straight_top', 'braking'):
        values = {n: r[key]['index'] for n, r in results.items() if isinstance(r.get(key), dict) and r[key].get('index') is not None}
        if values:
            best = min(values.values())
            for n, v in values.items():
                results[n][key]['gap_pct'] = (v/best-1)*100
    for band, _, _ in CORNER_BANDS:
        times = {n: r['cornering'][band]['time_vs_median_s'] for n, r in results.items()
                 if r.get('cornering', {}).get(band) and r['cornering'][band].get('index') is not None}
        if times:
            fastest = min(times.values())
            for n, v in times.items():
                results[n]['cornering'][band]['gap_s'] = v-fastest
    fades = {n: r['energy']['fade_kmh'] for n, r in results.items() if r.get('energy')}
    if fades:
        least = min(fades.values())
        for n, v in fades.items():
            results[n]['energy']['gap_kmh'] = v-least
