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
    # Calculate circuit-relative speed terciles across all apexes
    apex_speeds = [float(speed[z['apex']]) for z in zones]
    tercile_33 = float(np.percentile(apex_speeds, 33.3))
    tercile_66 = float(np.percentile(apex_speeds, 66.7))
    for z in zones:
        v = float(speed[z['apex']])
        z['tercile'] = 'slow' if v <= tercile_33 else 'mid' if v <= tercile_66 else 'fast'
        z['tercile_label'] = 'Slowest third' if v <= tercile_33 else 'Middle third' if v <= tercile_66 else 'Fastest third'

    reference_team = min(selected, key=lambda team: selected[team]['official'])
    ref = selected[reference_team]

    # Partition straight sections into early acceleration vs terminal velocity
    straight_blocks = []
    in_straight = False
    s_start = 0
    for idx in range(len(corner_mask)):
        if not corner_mask[idx] and not in_straight:
            in_straight = True
            s_start = idx
        elif corner_mask[idx] and in_straight:
            in_straight = False
            if grid[idx] - grid[s_start] >= 80:
                straight_blocks.append((s_start, idx))
    if in_straight and grid[-1] - grid[s_start] >= 80:
        straight_blocks.append((s_start, len(corner_mask)))

    results = {}
    grid_spacing = float(grid[1] - grid[0])
    for team, item in selected.items():
        measurements = []
        for z in zones:
            a, b, apex = z['start'], z['end'], z['apex']
            dt = float(item['dt'][a:b].sum())
            ref_dt = float(ref['dt'][a:b].sum())
            length = float(grid[b] - grid[a])
            time_lost = dt - ref_dt

            # Adaptive entry (-100 to -40m), apex (-40 to +40m), exit (+40 to +100m)
            step_40 = max(1, int(40 / grid_spacing))
            step_100 = max(2, int(100 / grid_spacing))
            en_a = max(a, apex - step_100)
            en_b = max(a, apex - step_40)
            ex_a = min(b, apex + step_40)
            ex_b = min(b, apex + step_100)
            ap_a = max(a, apex - step_40)
            ap_b = min(b, apex + step_40)

            entry_speed = float(np.median(item['speed'][en_a:en_b+1])) if en_b > en_a else float(item['speed'][en_a])
            apex_min_speed = float(min(item['speed'][ap_a:ap_b+1])) if ap_b > ap_a else float(item['speed'][apex])
            exit_speed = float(np.median(item['speed'][ex_a:ex_b+1])) if ex_b > ex_a else float(item['speed'][ex_b])

            ref_entry = float(np.median(ref['speed'][en_a:en_b+1])) if en_b > en_a else float(ref['speed'][en_a])
            ref_apex = float(min(ref['speed'][ap_a:ap_b+1])) if ap_b > ap_a else float(ref['speed'][apex])
            ref_exit = float(np.median(ref['speed'][ex_a:ex_b+1])) if ex_b > ex_a else float(ref['speed'][ex_b])

            loss_density = float((time_lost / max(1.0, length)) * 100 * 1000)  # ms per 100m

            measurements.append({
                'corner': z['corner'], 'band': z['band'], 'tercile': z['tercile'], 'tercile_label': z['tercile_label'],
                'time': dt, 'ref_time': ref_dt, 'time_lost': time_lost, 'loss_density': loss_density,
                'length': length, 'minimum': apex_min_speed, 'mean_speed': float(length / max(0.001, dt) * 3.6),
                'entry_speed': entry_speed, 'exit_speed': exit_speed,
                'delta_entry': entry_speed - ref_entry, 'delta_apex': apex_min_speed - ref_apex, 'delta_exit': exit_speed - ref_exit,
                'apex_distance': float(grid[apex])
            })

        categories = {}
        for band in ('low', 'medium', 'high'):
            indices = [i for i, z in enumerate(zones) if z['band'] == band]
            if not indices:
                categories[band] = None; continue
            band_time = sum(measurements[i]['time'] for i in indices)
            reference_time = sum(float(ref['dt'][zones[i]['start']:zones[i]['end']].sum()) for i in indices)
            lost = band_time - reference_time
            categories[band] = {
                'time': band_time, 'time_lost': lost,
                'deficit': lost / ref['official'] * 100, 'corners': len(indices),
                'speed': float(np.mean([measurements[i]['mean_speed'] for i in indices])),
                'mean_loss_density': float(np.mean([measurements[i]['loss_density'] for i in indices]))
            }

        # Tercile summary categories
        tercile_categories = {}
        for tercile in ('slow', 'mid', 'fast'):
            indices = [i for i, z in enumerate(zones) if z['tercile'] == tercile]
            if not indices:
                tercile_categories[tercile] = None; continue
            terc_time = sum(measurements[i]['time'] for i in indices)
            ref_terc_time = sum(float(ref['dt'][zones[i]['start']:zones[i]['end']].sum()) for i in indices)
            lost = terc_time - ref_terc_time
            tercile_categories[tercile] = {
                'time': terc_time, 'time_lost': lost,
                'deficit': lost / ref['official'] * 100, 'corners': len(indices),
                'speed': float(np.mean([measurements[i]['mean_speed'] for i in indices]))
            }

        # Straight-line two-phase breakdown
        early_accel_time = 0.0
        ref_early_accel_time = 0.0
        terminal_time = 0.0
        ref_terminal_time = 0.0
        terminal_speeds = []
        for s_start, s_end in straight_blocks:
            s_len = grid[s_end] - grid[s_start]
            accel_split = min(s_end, s_start + max(1, int(min(200.0, s_len * 0.5) / grid_spacing)))
            term_split = max(s_start, s_end - max(1, int(min(100.0, s_len * 0.35) / grid_spacing)))

            early_accel_time += float(item['dt'][s_start:accel_split].sum())
            ref_early_accel_time += float(ref['dt'][s_start:accel_split].sum())
            terminal_time += float(item['dt'][term_split:s_end].sum())
            ref_terminal_time += float(ref['dt'][term_split:s_end].sum())
            terminal_speeds.extend(item['speed'][term_split:s_end])

        straight_time = float(item['dt'][~corner_mask].sum())
        corner_time = float(item['dt'][corner_mask].sum())

        braking = []
        for z in zones:
            indices = np.where(item['brake'][z['start']:z['apex']+1])[0] + z['start']
            if len(indices) < 2:
                continue
            a, b = int(indices[0]), int(indices[-1]) + 1
            duration = float(item['dt'][a:b].sum())
            v_start = float(item['speed'][a])
            v_end = float(item['speed'][b-1])
            drop = v_start - v_end
            if duration >= .4 and drop >= 35:
                # Speed-midpoint split: early deceleration vs late deceleration
                v_mid = (v_start + v_end) / 2.0
                mid_idx = a
                for s_i in range(a, b):
                    if item['speed'][s_i] <= v_mid:
                        mid_idx = s_i
                        break
                mid_idx = max(a + 1, min(b - 1, mid_idx))
                early_dt = float(item['dt'][a:mid_idx].sum())
                late_dt = float(item['dt'][mid_idx:b].sum())
                early_g = (v_start - float(item['speed'][mid_idx])) / 3.6 / max(0.05, early_dt) / 9.80665
                late_g = (float(item['speed'][mid_idx]) - v_end) / 3.6 / max(0.05, late_dt) / 9.80665
                release_to_apex = float(grid[z['apex']] - grid[b-1])

                braking.append({
                    'start': float(grid[a]),
                    'distance': float(grid[b] - grid[a]),
                    'duration': duration,
                    'mean_g': drop / 3.6 / duration / 9.80665,
                    'early_g': float(early_g),
                    'late_g': float(late_g),
                    'release_to_apex': max(0.0, release_to_apex),
                    'sampling_resolution': 11.25  # ~±11m at 300km/h 3.7Hz
                })

        results[team] = {
            'corners': measurements, 'categories': categories, 'tercile_categories': tercile_categories,
            'straight_time': straight_time, 'corner_time': corner_time,
            'straight_contribution': float((straight_time - ref['dt'][~corner_mask].sum()) / ref['official'] * 100),
            'corner_contribution': float((corner_time - ref['dt'][corner_mask].sum()) / ref['official'] * 100),
            'early_accel_delta': float((early_accel_time - ref_early_accel_time) / ref['official'] * 100),
            'terminal_delta': float((terminal_time - ref_terminal_time) / ref['official'] * 100),
            'terminal_speed_mean': float(np.mean(terminal_speeds)) if terminal_speeds else None,
            'lap_gap': (item['official'] / ref['official'] - 1) * 100,
            'reference_lap_time': ref['official'],
            'top_speed': float(max(item['speed'])),
            'full_throttle_p95': float(np.percentile(item['speed'][item['throttle'] >= 98], 95)) if np.sum(item['throttle'] >= 98) >= 10 else None,
            'lap_distance': float(grid[-1]), 'braking': braking, 'selection': item['selection'],
            'quality': {'integration_scale': item['scale'], 'full_lap': True}
        }
    for r in results.values():
        r['straight_deficit'] = r['straight_contribution']
    return {'teams': results, 'reference_team': reference_team, 'excluded': {t: e for t, e in errors.items() if t not in results},
            'method': 'shared-gps-grid-v3-sampling-aware', 'corner_count': len(zones)}
