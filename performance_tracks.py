"""Field-aligned qualifying measurements, computed only inside a request."""
from collections import defaultdict
import math
import numpy as np


def prepare(samples, selection):
    a = np.array([[r.get('Distance'), r.get('ElapsedSeconds'), r.get('Speed'),
                   r.get('Throttle'), float(bool(r.get('Brake'))),
                   r.get('X'), r.get('Y'), float(r.get('DRS') or 0)] for r in samples], dtype=float)
    official = float(selection.get('time') or selection['end']-selection['start'])
    if len(a) < 100 or not np.isfinite(a[:, :5]).all():
        raise ValueError('Incomplete speed, throttle or time channels')
    if (np.any(np.diff(a[:, 0]) <= 0) or np.any(np.diff(a[:, 1]) <= 0)
            or np.max(np.diff(a[:, 1])) > 1.5 or np.min(a[:, 2]) < 30):
        raise ValueError('Gaps or invalid speed/distance in the qualifying lap')
    if abs(a[-1, 1]-a[0, 1]-official) > 1.5:
        raise ValueError('Telemetry does not cover the official lap')
    gps = np.isfinite(a[:, 5:7]).all(axis=1)
    if np.mean(gps) < .65:
        raise ValueError('Insufficient position coverage for shared track windows')
    return {'a': a, 'gps': gps, 'official': official, 'selection': selection, 'samples': samples}


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
    # Projection often clamps several GPS samples to the start/finish point.
    # Including those as interior knots creates a flat distance mapping and
    # therefore zero-duration grid cells, despite valid rising source times.
    interior = [(s, p) for s, p in zip(source, anchors)
                if a[0, 0] + 1e-6 < s < a[-1, 0] - 1e-6
                and 1e-6 < p < grid[-1] - 1e-6]
    aligned = np.interp(a[:, 0],
                        [a[0, 0], *(s for s, _ in interior), a[-1, 0]],
                        [0, *(p for _, p in interior), grid[-1]])
    if np.any(np.diff(aligned) <= 0):
        raise ValueError('GPS projection reverses progress along the lap')
    speed = np.interp(grid, aligned, a[:, 2])
    throttle = np.interp(grid, aligned, a[:, 3])
    brake = np.interp(grid, aligned, a[:, 4]) >= .5
    # Discrete forward-fill / nearest step for DRS on grid (FastF1 discrete channel rule)
    drs_indices = np.clip(np.searchsorted(aligned, grid, side='right') - 1, 0, len(a) - 1)
    drs_grid = a[drs_indices, 7].astype(int)
    drs_active = np.isin(drs_grid, [10, 12, 14])
    # The GPS mapping changes spatial coordinates. Integrating 1/speed over
    # the warped reference distance would omit ds_car/ds_reference and move
    # time between zones. Interpolate observed elapsed time instead.
    observed = np.interp(grid, aligned, a[:, 1])
    observed_dt = np.diff(observed)
    if np.any(observed_dt <= 0):
        raise ValueError('Elapsed-time alignment is not strictly increasing')
    timing_scale = item['official']/observed_dt.sum()
    # Validate speed against the car's original distance, not the warped
    # reference distance. Warping changes ds and can otherwise reject good GPS.
    speed_time = np.sum(np.diff(a[:, 0])*3.6*(1/a[:-1, 2]+1/a[1:, 2])/2)
    factor = item['official']/speed_time
    if not .92 < factor < 1.08 or not .97 < timing_scale < 1.03:
        raise ValueError('Speed integration disagrees with official lap time')
    return {**item, 'speed': speed, 'throttle': throttle, 'brake': brake,
            'drs': drs_grid, 'drs_active': drs_active,
            'dt': observed_dt*timing_scale, 'scale': float(factor),
            'timing_scale': float(timing_scale), 'aligned': aligned}


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


def analyze_straights_speed_domain(selected, straight_blocks, grid, ref, corner_mask):
    """Speed-domain straight-line performance analysis.

    1. Evaluates supported 50 km/h speed bands from 50–100 through 350–400
       from raw sample timestamps; unavailable bands remain absent.
    2. Enforces continuous clean air (>3.0s gap) throughout the entire measurement interval.
    3. Requires constant discrete DRS state (drs in {10, 12, 14}) throughout the band.
    4. Calculates within-straight relative deltas: delta_t = t - median(t_field) on each straight.
    5. Aggregates event score as median(delta_t) across valid straights, rebased to 0.000s baseline.
    6. Constructs a shared-coordinate terminal speed corridor on long straights (>=400m).
    7. Computes straight traversal delta for lap time attribution.
    """
    teams = list(selected.keys())
    session_times = {}
    for team, item in selected.items():
        t_start = float(item['selection'].get('start') or 0.0)
        session_times[team] = {
            't_start': t_start,
            'aligned': item['aligned'],
            'time': item['a'][:, 1]
        }

    def check_clean_air(team, d_start, d_end):
        """Verify that no other car was within 0 < gap <= 3.0s ahead anywhere across [d_start, d_end]."""
        this_start_t = session_times[team]['t_start']
        if this_start_t <= 0.0:
            return True
        eval_d = np.linspace(d_start, d_end, 7)
        this_aligned = session_times[team]['aligned']
        this_time = session_times[team]['time']
        T_this = this_start_t + np.interp(eval_d, this_aligned, this_time)

        for other_team, other_data in session_times.items():
            if other_team == team:
                continue
            if other_data['t_start'] <= 0.0:
                continue
            if abs(this_start_t - other_data['t_start']) > 180.0:
                continue
            T_other = other_data['t_start'] + np.interp(eval_d, other_data['aligned'], other_data['time'])
            gap = T_this - T_other
            if np.any((gap > 0.0) & (gap <= 3.0)):
                return False
        return True

    def interp_raw(raw_t, raw_v, target_v):
        idx = np.where(raw_v >= target_v)[0][0]
        if idx == 0:
            return float(raw_t[0])
        v0, v1 = float(raw_v[idx-1]), float(raw_v[idx])
        t0, t1 = float(raw_t[idx-1]), float(raw_t[idx])
        if abs(v1 - v0) < 1e-4:
            return float(t0)
        return float(t0 + (target_v - v0) / (v1 - v0) * (t1 - t0))

    bands = [(float(lo), float(lo + 50), f'{lo}_{lo + 50}')
             for lo in range(50, 400, 50)]
    # Keep the prior diagnostic available to existing consumers.
    bands.append((300.0, 320.0, '300_320'))

    straight_band_times = {b[2]: defaultdict(dict) for b in bands}
    accel_eligible_straights = []

    for s_idx, (s_start, s_end) in enumerate(straight_blocks):
        d_start = float(grid[s_start])
        d_end = float(grid[min(s_end, len(grid)-1)])
        s_len = d_end - d_start
        if s_len < 250.0:
            continue
        accel_eligible_straights.append(s_idx)

        # Check dominant DRS deployment on this straight across field
        drs_active_counts = [bool(np.mean(selected[t]['drs_active'][s_start:s_end]) >= 0.3) for t in teams]
        dominant_drs_open = bool(np.mean(drs_active_counts) >= 0.5)

        for team in teams:
            item = selected[team]
            aligned = item['aligned']
            a = item['a']
            mask = (aligned >= d_start - 30.0) & (aligned <= d_end + 30.0)
            raw_indices = np.where(mask)[0]
            if len(raw_indices) < 2:
                continue
            raw_t = a[raw_indices, 1]
            raw_v = a[raw_indices, 2]
            raw_th = a[raw_indices, 3]
            raw_br = a[raw_indices, 4] >= 0.5
            raw_drs = a[raw_indices, 7].astype(int)
            raw_drs_active = np.isin(raw_drs, [10, 12, 14])

            i_min = int(np.argmin(raw_v))
            i_max = int(np.argmax(raw_v))
            if i_max <= i_min:
                continue
            t_accel = raw_t[i_min:i_max+1]
            v_accel = raw_v[i_min:i_max+1]
            th_accel = raw_th[i_min:i_max+1]
            br_accel = raw_br[i_min:i_max+1]
            drs_accel = raw_drs_active[i_min:i_max+1]
            aligned_accel = aligned[raw_indices[i_min:i_max+1]]

            for v_lo, v_hi, b_name in bands:
                if v_accel[0] <= v_lo and v_accel[-1] >= v_hi:
                    idx_lo_candidates = np.where(v_accel >= v_lo)[0]
                    idx_hi_candidates = np.where(v_accel >= v_hi)[0]
                    if not len(idx_lo_candidates) or not len(idx_hi_candidates):
                        continue
                    i_lo = idx_lo_candidates[0]
                    i_hi = idx_hi_candidates[0]
                    if i_hi <= i_lo:
                        continue
                    if np.all(th_accel[i_lo:i_hi+1] >= 90) and not np.any(br_accel[i_lo:i_hi+1]):
                        drs_slice = drs_accel[i_lo:i_hi+1]
                        is_drs = bool(np.all(drs_slice))
                        is_no_drs = bool(not np.any(drs_slice))
                        if is_drs or is_no_drs:
                            if is_drs == dominant_drs_open:
                                t_lo = interp_raw(t_accel, v_accel, v_lo)
                                t_hi = interp_raw(t_accel, v_accel, v_hi)
                                dt_band = t_hi - t_lo
                                if 0.1 < dt_band < 25.0:
                                    d_lo = float(aligned_accel[i_lo])
                                    d_hi = float(aligned_accel[i_hi])
                                    if check_clean_air(team, d_lo, d_hi):
                                        straight_band_times[b_name][s_idx][team] = dt_band

    team_straight_deltas = {b[2]: defaultdict(list) for b in bands}
    for _, _, b_name in bands:
        for s_idx, team_times in straight_band_times[b_name].items():
            if len(team_times) >= 2:
                s_med = float(np.median(list(team_times.values())))
                for t, tm in team_times.items():
                    team_straight_deltas[b_name][t].append(tm - s_med)

    # Long-straight shared terminal speed corridor (straights >= 400m)
    team_terminal_speeds = defaultdict(list)
    total_corridor_len = 0.0

    for s_idx, (s_start, s_end) in enumerate(straight_blocks):
        d_start = float(grid[s_start])
        d_end = float(grid[min(s_end, len(grid)-1)])
        s_len = d_end - d_start
        if s_len < 400.0:
            continue

        brakes = []
        for team in teams:
            d = selected[team]
            mask = (d['aligned'] >= d_start + 200.0) & (d['aligned'] <= d_end + 50.0)
            idx = np.where(mask)[0]
            if not len(idx):
                brakes.append(d_end)
                continue
            br_idx = np.where((d['a'][idx, 4] >= 0.5) | (d['a'][idx, 3] < 90))[0]
            if len(br_idx):
                brakes.append(float(d['aligned'][idx[br_idx[0]]]))
            else:
                brakes.append(d_end)

        if brakes:
            med_b = float(np.median(brakes))
            rep_b = [x for x in brakes if x >= med_b - 120.0]
            if not rep_b:
                rep_b = brakes
            end_corridor = min(rep_b) - 10.0
            corridor_len = 80.0
            start_corridor = end_corridor - corridor_len
            total_corridor_len += corridor_len

            i1 = int(round(start_corridor / 5.0))
            i2 = int(round(end_corridor / 5.0))
            i1 = max(0, min(len(grid) - 1, i1))
            i2 = max(0, min(len(grid) - 1, i2))
            if i2 > i1:
                L_corridor = float(grid[i2] - grid[i1])
                for team in teams:
                    item = selected[team]
                    if not np.any(item['brake'][i1:i2]):
                        if check_clean_air(team, start_corridor, end_corridor):
                            dt_corridor = float(item['dt'][i1:i2].sum())
                            if dt_corridor > 0.05:
                                v_corridor = (L_corridor / dt_corridor) * 3.6
                                team_terminal_speeds[team].append(v_corridor)

    straight_results = {}
    tot_accel_straights = max(1, len(straight_band_times['250_300']))

    # Representative 250->300 benchmark time across straights for percentage deficit normalization
    med_straight_times = [float(np.median(list(tt.values()))) for tt in straight_band_times['250_300'].values() if len(tt) >= 2]
    ref_250_time = float(np.median(med_straight_times)) if med_straight_times else 2.0

    raw_bands = {name: {t: float(np.median(team_straight_deltas[name][t]))
                         if team_straight_deltas[name][t] else None for t in teams}
                 for _, _, name in bands}
    best_bands = {name: min((v for v in values.values() if v is not None), default=0.0)
                  for name, values in raw_bands.items()}

    avg_term_speeds = {t: float(np.mean(team_terminal_speeds[t])) if team_terminal_speeds[t] else None for t in teams}
    max_term_speed = max([v for v in avg_term_speeds.values() if v is not None], default=None)

    ref_straight_time = float(ref['dt'][~corner_mask].sum())

    for team in teams:
        item = selected[team]
        straight_time = float(item['dt'][~corner_mask].sum())
        traversal_delta = float((straight_time - ref_straight_time) / ref['official'] * 100)

        deltas_250 = team_straight_deltas['250_300'][team]
        cov_count = len(deltas_250)
        cov_str = f"{cov_count}/{tot_accel_straights}"
        is_provisional = bool(cov_count < 2 or cov_count < tot_accel_straights * 0.5)

        accel_250 = (raw_bands['250_300'][team] - best_bands['250_300']) if raw_bands['250_300'][team] is not None else None
        accel_250_pct = float(accel_250 / max(0.1, ref_250_time) * 100) if accel_250 is not None else None
        accel_200 = (raw_bands['200_250'][team] - best_bands['200_250']) if raw_bands['200_250'][team] is not None else None
        accel_320 = (raw_bands['300_320'][team] - best_bands['300_320']) if raw_bands['300_320'][team] is not None else None
        phase_bands = {name: {'gap_s': float(raw_bands[name][team] - best_bands[name]),
                              'straights': len(team_straight_deltas[name][team])}
                       for _, _, name in bands if raw_bands[name][team] is not None and name != '300_320'}

        all_team_sums = [sum(team_straight_deltas['250_300'][t]) for t in teams if team_straight_deltas['250_300'][t]]
        min_cumul = min(all_team_sums) if all_team_sums else 0.0
        cumul_loss = float(sum(deltas_250) - min_cumul) if deltas_250 else 0.0

        term_speed = avg_term_speeds[team]
        term_deficit = float(max_term_speed - term_speed) if (term_speed is not None and max_term_speed is not None) else None

        straight_results[team] = {
            'straight_time': straight_time,
            'straight_traversal_delta': traversal_delta,
            'straight_contribution': traversal_delta,
            'straight_deficit': traversal_delta,
            'accel_250_300': float(accel_250) if accel_250 is not None else None,
            'accel_250_300_pct': float(accel_250_pct) if accel_250_pct is not None else None,
            'accel_200_250': float(accel_200) if accel_200 is not None else None,
            'accel_300_320': float(accel_320) if accel_320 is not None else None,
            'accel_bands': phase_bands,
            'accel_cumul_loss_250_300': float(max(0.0, cumul_loss)),
            'straight_coverage': cov_str,
            'straight_provisional': is_provisional,
            'terminal_zone_mean_speed': term_speed,
            'terminal_speed_deficit': term_deficit,
            'terminal_zone_length_m': float(total_corridor_len) if term_speed is not None else None,
            'top_speed': float(max(item['speed'])),
            'speed_st': float(item['selection'].get('speed_st')) if item['selection'].get('speed_st') is not None else None,
            'speed_fl': float(item['selection'].get('speed_fl')) if item['selection'].get('speed_fl') is not None else None
        }

    return straight_results


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
    valid_choices = {team: values for team, values in choices.items() if values}
    for values in valid_choices.values():
        values.sort(key=lambda r: r['official'])
    # Retain independently validated laps even when other teams have missing
    # GPS. The response reports coverage; season ranking sets its own support.
    minimum = 2
    if len(valid_choices) < minimum:
        return {'teams': {}, 'error': 'Too few teams have complete qualifying telemetry', 'excluded': errors}
    reference = min((v[0] for v in valid_choices.values()), key=lambda r: r['official'])
    for _ in range(len(valid_choices) + 1):
        grid = np.linspace(0, reference['a'][-1, 0], int(reference['a'][-1, 0]/5)+1)
        aligned = defaultdict(list)
        for team, values in valid_choices.items():
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
        reference_team = min(selected, key=lambda team: selected[team]['official'])
        chosen = selected[reference_team]
        if chosen['selection'] is reference['selection']:
            break
        reference = chosen
    else:
        return {'teams': {}, 'error': 'No stable reference lap passed telemetry checks', 'excluded': errors}
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
        d_prev = float(grid[apex] - grid[apexes[k-1]]) if k else 150.0
        d_next = float(grid[apexes[k+1]] - grid[apex]) if k+1 < len(apexes) else 150.0
        d_entry = min(75.0, d_prev / 2.0)
        d_exit = min(75.0, d_next / 2.0)
        zones.append({'start': start, 'end': end, 'apex': apex, 'corner': label,
                      'd_entry': d_entry, 'd_exit': d_exit,
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

    ref = selected[reference_team]

    # Partition straight sections (non-overlapping adaptive split)
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

    # Compute speed-domain straight-line performance across the field
    straight_perf = analyze_straights_speed_domain(selected, straight_blocks, grid, ref, corner_mask)

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

            # Geometry-aware entry/exit boundaries (no artificial 40m floor)
            d_en = z.get('d_entry', 50.0)
            d_ex = z.get('d_exit', 50.0)
            step_15 = max(1, int(15.0 / grid_spacing))  # 15m local median window
            en_idx = max(a, apex - max(1, int(d_en / grid_spacing)))
            ex_idx = min(b, apex + max(1, int(d_ex / grid_spacing)))

            en_lo, en_hi = max(a, en_idx - step_15), min(b, en_idx + step_15 + 1)
            ex_lo, ex_hi = max(a, ex_idx - step_15), min(b, ex_idx + step_15 + 1)
            ap_lo, ap_hi = max(a, apex - step_15), min(b, apex + step_15 + 1)

            entry_speed = float(np.median(item['speed'][en_lo:en_hi]))
            apex_min_speed = float(np.min(item['speed'][ap_lo:ap_hi]))
            exit_speed = float(np.median(item['speed'][ex_lo:ex_hi]))

            ref_entry = float(np.median(ref['speed'][en_lo:en_hi]))
            ref_apex = float(np.min(ref['speed'][ap_lo:ap_hi]))
            ref_exit = float(np.median(ref['speed'][ex_lo:ex_hi]))

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

        straight_info = straight_perf.get(team, {})
        straight_time = straight_info.get('straight_time', float(item['dt'][~corner_mask].sum()))
        corner_time = float(item['dt'][corner_mask].sum())

        braking = []
        for z in zones:
            indices = np.where(item['brake'][z['start']:z['apex']+1])[0] + z['start']
            if len(indices) < 2:
                continue
            a, b = int(indices[0]), int(indices[-1]) + 1
            duration = float(item['dt'][a:b].sum())
            v_start_kmh = float(item['speed'][a])
            v_end_kmh = float(item['speed'][b-1])
            drop_kmh = v_start_kmh - v_end_kmh
            if duration >= .4 and drop_kmh >= 35:
                # Explicit SI unit conversion: km/h -> m/s before all deceleration & resolution formulas
                v_start_ms = v_start_kmh / 3.6
                v_end_ms = v_end_kmh / 3.6
                dist_m = float(grid[b] - grid[a])

                # Speed-midpoint split: early deceleration vs late deceleration
                v_mid_kmh = (v_start_kmh + v_end_kmh) / 2.0
                mid_idx = a
                for s_i in range(a, b):
                    if item['speed'][s_i] <= v_mid_kmh:
                        mid_idx = s_i
                        break
                mid_idx = max(a + 1, min(b - 1, mid_idx))
                early_dt = float(item['dt'][a:mid_idx].sum())
                late_dt = float(item['dt'][mid_idx:b].sum())
                v_mid_ms = float(item['speed'][mid_idx]) / 3.6

                early_g = (v_start_ms - v_mid_ms) / max(0.05, early_dt) / 9.80665
                late_g = (v_mid_ms - v_end_ms) / max(0.05, late_dt) / 9.80665
                mean_g = (v_start_ms - v_end_ms) / max(0.05, duration) / 9.80665

                # Distance-normalized deceleration in g:
                # a_norm = (v_entry_ms^2 - v_exit_ms^2) / (2 * g * distance_m)
                a_norm = (v_start_ms**2 - v_end_ms**2) / (2.0 * 9.80665 * max(1.0, dist_m))

                # The true onset is bounded by consecutive source samples,
                # not by adjacent points on the interpolated five-metre grid.
                raw_onsets = np.where((item['a'][:, 4] >= .5)
                                      & (item['aligned'] >= grid[z['start']] - 50)
                                      & (item['aligned'] <= grid[z['apex']]))[0]
                raw_first = int(raw_onsets[0]) if len(raw_onsets) else None
                onset_bracket = ([float(item['aligned'][raw_first-1]),
                                  float(item['aligned'][raw_first])]
                                 if raw_first is not None and raw_first > 0 else None)
                sampling_res_m = (onset_bracket[1] - onset_bracket[0]
                                  if onset_bracket else None)
                release_to_apex = float(grid[z['apex']] - grid[b-1])

                ref_b_dt = float(ref['dt'][a:b].sum())
                brake_time_delta = duration - ref_b_dt

                braking.append({
                    'corner': z['corner'],
                    'start': float(grid[a]),
                    'corridor_time': float(item['dt'][z['start']:z['apex']+1].sum()),
                    'corridor_ref_time': float(ref['dt'][z['start']:z['apex']+1].sum()),
                    'distance': dist_m,
                    'duration': duration,
                    'entry_speed': v_start_kmh,
                    'exit_speed': v_end_kmh,
                    'mean_g': float(mean_g),
                    'early_g': float(early_g),
                    'late_g': float(late_g),
                    'normalized_decel_g': float(a_norm),
                    'time_delta': float(brake_time_delta),
                    'onset_bracket': onset_bracket,
                    'release_to_apex': max(0.0, release_to_apex),
                    'sampling_resolution_m': sampling_res_m
                })

        results[team] = {
            'corners': measurements, 'categories': categories, 'tercile_categories': tercile_categories,
            'straight_time': straight_time, 'corner_time': corner_time,
            'straight_traversal_delta': straight_info.get('straight_traversal_delta', 0.0),
            'straight_contribution': straight_info.get('straight_contribution', 0.0),
            'straight_deficit': straight_info.get('straight_deficit', 0.0),
            'accel_250_300': straight_info.get('accel_250_300'),
            'accel_250_300_pct': straight_info.get('accel_250_300_pct'),
            'accel_200_250': straight_info.get('accel_200_250'),
            'accel_300_320': straight_info.get('accel_300_320'),
            'accel_bands': straight_info.get('accel_bands', {}),
            'accel_cumul_loss_250_300': straight_info.get('accel_cumul_loss_250_300', 0.0),
            'straight_coverage': straight_info.get('straight_coverage', '0/0'),
            'straight_provisional': straight_info.get('straight_provisional', False),
            'corner_contribution': float((corner_time - ref['dt'][corner_mask].sum()) / ref['official'] * 100),
            'terminal_zone_mean_speed': straight_info.get('terminal_zone_mean_speed'),
            'terminal_speed_mean': straight_info.get('terminal_zone_mean_speed'),
            'terminal_speed_deficit': straight_info.get('terminal_speed_deficit'),
            'terminal_zone_length_m': straight_info.get('terminal_zone_length_m', 80.0),
            'speed_st': straight_info.get('speed_st'),
            'speed_fl': straight_info.get('speed_fl'),
            'lap_gap': (item['official'] / ref['official'] - 1) * 100,
            'reference_lap_time': ref['official'],
            'top_speed': float(max(item['speed'])),
            'full_throttle_p95': float(np.percentile(item['speed'][item['throttle'] >= 98], 95)) if np.sum(item['throttle'] >= 98) >= 10 else None,
            'lap_distance': float(grid[-1]), 'braking': braking, 'selection': item['selection'],
            'quality': {'integration_scale': item['scale'], 'full_lap': True}
        }

    # Cross-circuit continuous features for development trend regression
    circuit_features = {
        'median_apex_speed': float(np.median(apex_speeds)),
        'high_speed_share': float(np.mean([s > 200.0 for s in apex_speeds])),
        'straight_distance_share': float(np.sum(~corner_mask) / max(1, len(corner_mask))),
        'corner_count': len(zones)
    }

    return {'teams': results, 'reference_team': reference_team, 'excluded': {t: e for t, e in errors.items() if t not in results},
            'method': 'shared-gps-grid-v3-sampling-aware', 'corner_count': len(zones),
            'circuit_features': circuit_features}

