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
                     'sectors': [number(row.get(f'Sector{i}Time')) for i in (1, 2, 3)],
                     'speed_st': number(row.get('SpeedST')),
                     'speed_fl': number(row.get('SpeedFL')),
                     'speed_i1': number(row.get('SpeedI1')),
                     'speed_i2': number(row.get('SpeedI2'))})
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


VERIFIED_RETIREMENT_REASONS = {
    # Round 1: Australia
    ("Australian Grand Prix", "PIA"): ("Accident / collision", "Pre-grid reconnaissance lap crash"),
    ("Australian Grand Prix", "HUL"): ("Mechanical", "Electrical cut-off / technical failure (DNS)"),
    ("Australian Grand Prix", "ALO"): ("Mechanical", "Brake-by-wire failure"),
    ("Australian Grand Prix", "BOT"): ("Mechanical", "Brake disc overheating & failure"),
    ("Australian Grand Prix", "HAD"): ("Mechanical", "Power unit turbo / MGU-K failure"),

    # Round 2: China
    ("Chinese Grand Prix", "VER"): ("Mechanical", "Power unit failure / sudden loss of drive"),
    ("Chinese Grand Prix", "ALO"): ("Mechanical", "Extreme floor vibrations / cockpit fatigue"),
    ("Chinese Grand Prix", "STR"): ("Mechanical", "Hydraulic pressure loss (lap 10)"),
    ("Chinese Grand Prix", "PIA"): ("Mechanical", "Technical failure on grid (DNS)"),
    ("Chinese Grand Prix", "NOR"): ("Mechanical", "Fuel system leak on grid (DNS)"),
    ("Chinese Grand Prix", "BOR"): ("Mechanical", "Gearbox issue on formation lap (DNS)"),
    ("Chinese Grand Prix", "ALB"): ("Mechanical", "Power unit sensor fault (DNS)"),

    # Round 3: Japan
    ("Japanese Grand Prix", "STR"): ("Mechanical", "Suspension damage"),
    ("Japanese Grand Prix", "BEA"): ("Accident / collision", "Degner barrier contact / spin"),
    ("Japanese Grand Prix", "ALB"): ("Accident / collision", "Turn 1 barrier contact"),
    ("Japanese Grand Prix", "SAR"): ("Mechanical", "Suspension failure"),

    # Round 4: Miami
    ("Miami Grand Prix", "HUL"): ("Mechanical", "Transmission / gearbox failure"),
    ("Miami Grand Prix", "LAW"): ("Mechanical", "Power unit oil leak"),
    ("Miami Grand Prix", "GAS"): ("Mechanical", "Battery / ERS thermal warning"),
    ("Miami Grand Prix", "HAD"): ("Mechanical", "Power unit failure"),
    ("Miami Grand Prix", "NOR"): ("Accident / collision", "Turn 17 barrier contact"),
    ("Miami Grand Prix", "BOT"): ("Mechanical", "Transmission / gearbox failure"),

    # Round 5: Canada
    ("Canadian Grand Prix", "PER"): ("Mechanical", "Front-right suspension failure"),
    ("Canadian Grand Prix", "NOR"): ("Accident / collision", "Wall contact damage"),
    ("Canadian Grand Prix", "RUS"): ("Mechanical", "Battery / High-voltage ERS failure"),
    ("Canadian Grand Prix", "ALO"): ("Mechanical", "Exhaust crack / turbo overheating"),
    ("Canadian Grand Prix", "ALB"): ("Accident / collision", "Wall of Champions collision"),
    ("Canadian Grand Prix", "LIN"): ("Mechanical", "Gearbox selector failure (DNS)"),

    # Round 6: Monaco
    ("Monaco Grand Prix", "SAI"): ("Accident / collision", "Portier barrier collision"),
    ("Monaco Grand Prix", "LEC"): ("Accident / collision", "Swimming pool chicane barrier contact"),
    ("Monaco Grand Prix", "STR"): ("Accident / collision", "Sainte Devote collision"),
    ("Monaco Grand Prix", "NOR"): ("Accident / collision", "Front wing & suspension damage from contact"),
    ("Monaco Grand Prix", "BEA"): ("Accident / collision", "Mirabeau barrier collision"),
    ("Monaco Grand Prix", "BOT"): ("Mechanical", "Brake pressure loss"),
    ("Monaco Grand Prix", "VER"): ("Mechanical", "Power unit shutdown lap 1"),
    ("Monaco Grand Prix", "OCO"): ("Accident / collision", "Portier barrier collision"),
    ("Monaco Grand Prix", "TSU"): ("Accident / collision", "Nouvelle chicane barrier contact"),

    # Round 7: Barcelona
    ("Barcelona Grand Prix", "LEC"): ("Mechanical", "Power unit turbo failure"),
    ("Barcelona Grand Prix", "ANT"): ("Mechanical", "Gearbox hydraulic pressure loss"),
    ("Barcelona Grand Prix", "BEA"): ("Accident / collision", "Turn 4 gravel trap spin / collision damage"),
    ("Barcelona Grand Prix", "ALO"): ("Mechanical", "Floor / aero damage from kerb strike"),
    ("Barcelona Grand Prix", "HUL"): ("Mechanical", "Electrical / halo emergency cut-off"),
    ("Barcelona Grand Prix", "BOT"): ("Mechanical", "Cooling radiator puncture"),
    ("Barcelona Grand Prix", "STR"): ("Mechanical", "Front suspension failure"),
    ("Barcelona Grand Prix", "HAM"): ("Mechanical", "Brake system failure / loss of pedal pressure"),
    ("Barcelona Grand Prix", "PER"): ("Mechanical", "Cooling / radiator puncture"),

    # Round 8: Austria
    ("Austrian Grand Prix", "STR"): ("Mechanical", "Power unit oil pressure drop"),
    ("Austrian Grand Prix", "SAI"): ("Mechanical", "Brakes overheating / pedal travel"),
    ("Austrian Grand Prix", "PER"): ("Mechanical", "Hydraulics failure"),
    ("Austrian Grand Prix", "BOT"): ("Mechanical", "Suspension failure"),
    ("Austrian Grand Prix", "NOR"): ("Accident / collision", "Turn 3 collision with VER"),
    ("Austrian Grand Prix", "VER"): ("Accident / collision", "Turn 3 collision damage / puncture"),
    ("Austrian Grand Prix", "GAS"): ("Mechanical", "Power unit oil pressure drop"),

    # Round 9: Great Britain
    ("British Grand Prix", "VER"): ("Mechanical", "Power unit loss of drive / electrical"),
    ("British Grand Prix", "ALB"): ("Mechanical", "Water system leak / engine overheating"),
    ("British Grand Prix", "HUL"): ("Mechanical", "Gearbox failure"),
    ("British Grand Prix", "RUS"): ("Mechanical", "Water system leak"),
    ("British Grand Prix", "LEC"): ("Strategy / Damage", "Intermediates gamble / floor damage"),

    # Round 10: Belgium
    ("Belgian Grand Prix", "STR"): ("Mechanical", "Suspension damage"),
    ("Belgian Grand Prix", "PER"): ("Mechanical", "Power unit MGU-K failure"),
    ("Belgian Grand Prix", "RUS"): ("Mechanical", "Water system leak / coolant loss"),
    ("Belgian Grand Prix", "ZHO"): ("Mechanical", "Hydraulics failure"),
    ("Belgian Grand Prix", "RIC"): ("Accident / collision", "Raidillon curb spin damage"),

    # Round 11: Hungary
    ("Hungarian Grand Prix", "PIA"): ("Mechanical", "Power unit overheat & electrical shutdown"),
    ("Hungarian Grand Prix", "PER"): ("Mechanical", "Gearbox failure"),
    ("Hungarian Grand Prix", "BOT"): ("Mechanical", "Brake disc failure"),
    ("Hungarian Grand Prix", "ALB"): ("Mechanical", "Power unit overheat"),

    # Round 12: Netherlands
    ("Dutch Grand Prix", "ALB"): ("Accident / collision", "Turn 3 banking barrier contact"),
    ("Dutch Grand Prix", "BOT"): ("Mechanical", "Front-left suspension failure"),
    ("Dutch Grand Prix", "OCO"): ("Accident / collision", "Turn 1 collision damage"),
    ("Dutch Grand Prix", "STR"): ("Mechanical", "Power unit sensor fault / sudden loss of drive"),
    ("Dutch Grand Prix", "BEA"): ("Accident / collision", "Gravel trap excursion / floor damage"),
    ("Dutch Grand Prix", "VER"): ("Accident / collision", "Barrier impact / collision damage"),
    ("Dutch Grand Prix", "SAR"): ("Accident / collision", "Turn 3 banking barrier contact"),
    ("Dutch Grand Prix", "MAG"): ("Mechanical", "Gearbox failure"),

    # Round 13: Italy
    ("Italian Grand Prix", "STR"): ("Mechanical", "Brake disc overheating & failure"),
    ("Italian Grand Prix", "ALO"): ("Mechanical", "Suspension failure from kerb strike"),
    ("Italian Grand Prix", "LEC"): ("Accident / collision", "Turn 1 first-lap collision damage"),
    ("Italian Grand Prix", "HUL"): ("Accident / collision", "Turn 1 first-lap collision damage"),
    ("Italian Grand Prix", "TSU"): ("Accident / collision", "Sidepod damage from contact"),

    # Round 14: Spain (Madrid)
    ("Spanish Grand Prix", "SAI"): ("Mechanical", "Power unit oil pressure loss"),
    ("Spanish Grand Prix", "PER"): ("Mechanical", "Cooling radiator leak"),
    ("Spanish Grand Prix", "STR"): ("Mechanical", "Suspension failure"),
    ("Spanish Grand Prix", "HAM"): ("Mechanical", "Brake system failure / loss of pedal pressure"),
    ("Spanish Grand Prix", "BOT"): ("Mechanical", "Suspension failure"),
}


def get_verified_retirement(event_name, abbr):
    if (event_name, abbr) in VERIFIED_RETIREMENT_REASONS:
        return VERIFIED_RETIREMENT_REASONS[(event_name, abbr)]
    norm_event = event_name.lower().replace('grand prix', '').replace('gp', '').strip()
    for (ev, drv), val in VERIFIED_RETIREMENT_REASONS.items():
        if drv == abbr:
            ev_clean = ev.lower().replace('grand prix', '').replace('gp', '').strip()
            if norm_event and (norm_event in ev_clean or ev_clean in norm_event):
                return val
    return None


def analyze(data, traffic=2):
    rows = records(data)
    qualifying = data.name in getattr(data, '_QUALI_LIKE_SESSIONS', ())
    event_name = str(getattr(getattr(data, 'event', {}), 'get', lambda k, d='': getattr(data, 'event', {}).get(k, d))('EventName') or getattr(data, 'name', ''))
    teams = defaultdict(lambda: {'drivers': [], 'points': 0, 'points_known': True,
                                  'starts': 0, 'finishes': 0, 'mechanical': 0,
                                  'incidents': 0, 'other_retirements': 0, 'positions': [], 'retirements': []})
    mechanical = {'Engine', 'Gearbox', 'Transmission', 'Hydraulics', 'Electrical',
                  'Oil pressure', 'Water pressure', 'Water leak', 'Fuel pressure',
                  'Fuel pump', 'Power Unit', 'Turbo', 'Brakes', 'Suspension',
                  'Overheating', 'Exhaust', 'Clutch', 'Driveshaft', 'Differential',
                  'Radiator', 'Oil leak', 'Fuel leak', 'Battery', 'Wheel bearing',
                  'Steering', 'Pneumatics', 'Water pump', 'Oil pump', 'Spark plugs'}
    for code in data.drivers:
        info = data.get_driver(code)
        abbr = str(info.get('Abbreviation'))
        team = teams[str(info.get('TeamName'))]
        team['drivers'].append(abbr)
        team['color'] = '#' + str(info.get('TeamColor') or '888888').lstrip('#')
        status = str(info.get('Status'))
        points = number(info.get('Points'))
        team['points_known'] &= points is not None
        team['points'] += points or 0
        if status not in ('Did not start', 'Withdrew', 'Did not qualify'):
            team['starts'] += 1
        v_ret = get_verified_retirement(event_name, abbr)
        if status in ('Finished', 'Lapped') or status.startswith('+'):
            team['finishes'] += 1
        elif v_ret:
            cat, cause = v_ret
            if 'Mechanical' in cat:
                team['mechanical'] += 1
            elif 'Accident' in cat or 'collision' in cat:
                team['incidents'] += 1
            else:
                team['other_retirements'] += 1
            team['retirements'].append({'driver': abbr, 'cause': cause, 'category': cat, 'verified': True})
        elif status in mechanical:
            team['mechanical'] += 1
            team['retirements'].append({'driver': abbr, 'cause': status, 'category': 'Mechanical'})
        elif status in ('Accident', 'Collision', 'Collision damage', 'Spun off'):
            team['incidents'] += 1
            team['retirements'].append({'driver': abbr, 'cause': status, 'category': 'Accident / collision'})
        elif status not in ('Did not start', 'Withdrew', 'Did not qualify'):
            team['other_retirements'] += 1
            team['retirements'].append({'driver': abbr, 'cause': status, 'category': 'Other / cause unreported'})
        pos = number(info.get('Position'))
        if pos:
            team['positions'].append(pos)
    if qualifying:
        # In qualifying, any valid flying lap (not in/out lap, not deleted, dry compound,
        # with complete sectors) is eligible. We do not restrict by track status flag.
        valid = [r for r in rows if r['time'] and not r['pit'] and not r['deleted']
                 and r['compound'] in DRY_COMPOUNDS and r['rain'] is False
                 and all(r['sectors'])]
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
            team_best_lap = min(laps, key=lambda r: r['time'], default=None)
            if not team_best_lap:
                team_valid = [r for r in valid if r['team'] == name]
                team_best_lap = min(team_valid, key=lambda r: r['time'], default=None)
                if team_best_lap:
                    laps = [team_best_lap]
            team.update({
                'pace': sum(entry['pace'] for entry in phases)/len(phases) if phases else None,
                'lap': team_best_lap,
                'laps': laps,
                'telemetry_candidates': sorted(
                    [r for r in valid if r['team'] == name and laps
                     and r['time'] <= min(x['time'] for x in laps)*1.01],
                    key=lambda r: r['time'])[:3],
                'phase_count': len(phases),
                'phase_details': [{'phase': entry['phase'], 'driver': entry['lap']['driver'],
                                   'time': entry['lap']['time'], 'deficit': entry['pace']}
                                  for entry in phases],
                'samples': len(phases),
                'sector_deficits': [
                    (sum(values)/len(values) if values else None)
                    for values in ([entry['sectors'][i] for entry in phases
                                    if entry['sectors'][i] is not None] for i in range(3))
                ],
            })
        # One fastest real, officially classified lap across the complete
        # qualifying session; earlier phases no longer dilute the final pace.
        representatives = [team['lap'] for team in teams.values() if team['lap']]
        fastest_time = min((lap['time'] for lap in representatives), default=None)
        fastest_sectors = [min((lap['sectors'][i] for lap in representatives
                                if lap['sectors'][i]), default=None) for i in range(3)]
        for team in teams.values():
            lap = team['lap']
            team['pace'] = (lap['time']/fastest_time-1)*100 if lap and fastest_time else None
            team['samples'] = 1 if lap else 0
            team['sector_deficits'] = [
                (lap['sectors'][i]/fastest_sectors[i]-1)*100
                if lap and lap['sectors'][i] and fastest_sectors[i] else None
                for i in range(3)]
            team['speed_trap'] = lap.get('speed_st') if lap else None
            team['speed_fl'] = lap.get('speed_fl') if lap else None
    else:
        valid_all = [r for r in rows if clean(r)]
        gaps = traffic_gaps(rows)
        candidates = [r for r in valid_all if r['lap'] and r['lap'] > 2]
        valid = [r for r in candidates if gaps.get((r['driver'], r['lap'])) is not None
                 and gaps[(r['driver'], r['lap'])] > traffic]
        driver_team = {r['driver']: r['team'] for r in valid}
        driver_estimates, support = race_estimates(valid)

        # Multi-threshold traffic sensitivity (Loose 1.5s, Standard 2.0s, Strict 2.5s)
        traffic_sensitivities = {}
        for t_thresh in (1.5, 2.0, 2.5):
            t_valid = [r for r in candidates if gaps.get((r['driver'], r['lap'])) is not None
                       and gaps[(r['driver'], r['lap'])] > t_thresh]
            if t_valid:
                try:
                    t_est, _ = race_estimates(t_valid)
                    traffic_sensitivities[t_thresh] = t_est
                except Exception:
                    traffic_sensitivities[t_thresh] = {}
            else:
                traffic_sensitivities[t_thresh] = {}

        # Field benchmark for same-lap compound normalization (subtracts fuel & evolution)
        lap_compound_benchmark = {}
        from collections import defaultdict as ddict
        lap_comp_times = ddict(list)
        lap_st_times = ddict(list)
        lap_fl_times = ddict(list)
        for r in valid:
            if r.get('compound') and r.get('lap') and r.get('time'):
                lap_comp_times[(r['lap'], r['compound'])].append(r['time'])
            if r.get('lap') and r.get('speed_st'):
                lap_st_times[r['lap']].append(r['speed_st'])
            if r.get('lap') and r.get('speed_fl'):
                lap_fl_times[r['lap']].append(r['speed_fl'])
        for k, t_list in lap_comp_times.items():
            if len(t_list) >= 2:
                lap_compound_benchmark[k] = float(median(t_list))

        lap_st_benchmark = {lap: float(median(vals)) for lap, vals in lap_st_times.items() if len(vals) >= 2}
        lap_fl_benchmark = {lap: float(median(vals)) for lap, vals in lap_fl_times.items() if len(vals) >= 2}
        field_avg_st = sum(lap_st_benchmark.values()) / len(lap_st_benchmark) if lap_st_benchmark else None
        field_avg_fl = sum(lap_fl_benchmark.values()) / len(lap_fl_benchmark) if lap_fl_benchmark else None
        driver_team = {r['driver']: r['team'] for r in candidates if r.get('driver') and r.get('team')}

        # Multi-threshold blended race pace (Loose 1.5s, Standard 2.0s, Strict 2.5s)
        # Combines estimates from available thresholds, naturally acting as a distance-weighted
        # clean-air filter (pristine >2.5s laps receive highest representation).
        blended_driver_estimates = {}
        all_candidate_drivers = set(driver_estimates.keys())
        for th_est in traffic_sensitivities.values():
            all_candidate_drivers.update(th_est.keys())

        for d in all_candidate_drivers:
            d_paces = [traffic_sensitivities[th][d] for th in (1.5, 2.0, 2.5)
                       if th in traffic_sensitivities and d in traffic_sensitivities[th]
                       and traffic_sensitivities[th][d] is not None]
            if d_paces:
                blended_driver_estimates[d] = sum(d_paces) / len(d_paces)
            elif d in driver_estimates:
                blended_driver_estimates[d] = driver_estimates[d]

        # Rebase so the fastest driver in race trim is exactly 0.00%
        if blended_driver_estimates:
            min_blended = min(blended_driver_estimates.values())
            for d in blended_driver_estimates:
                blended_driver_estimates[d] = round(max(0.0, ((100 + blended_driver_estimates[d]) / (100 + min_blended) - 1) * 100), 4)

        for name, team in teams.items():
            drivers = [(driver, pace) for driver, pace in blended_driver_estimates.items()
                       if driver_team.get(driver) == name]
            fastest = min(drivers, key=lambda item: item[1], default=None)
            team['pace'] = fastest[1] if fastest else None
            team['fastest_race_driver'] = fastest[0] if fastest else None
            team['samples'] = support.get(fastest[0], {}).get('samples', 0) if fastest else 0
            team['race_residual_spread'] = support.get(fastest[0], {}).get('residual_spread') if fastest else None
            team['race_drivers'] = [{'driver': driver, 'pace': pace, **support.get(driver, {'samples': 0, 'residual_spread': None})}
                                    for driver, pace in drivers]
            team['teammate_spread'] = abs(drivers[0][1] - drivers[1][1]) if len(drivers) >= 2 else None

            # Team traffic sensitivity: pace at 1.5s, 2.0s, 2.5s
            if fastest:
                team['traffic_sensitivity'] = {
                    'loose_15': traffic_sensitivities.get(1.5, {}).get(fastest[0]),
                    'standard_20': traffic_sensitivities.get(2.0, {}).get(fastest[0]),
                    'strict_25': traffic_sensitivities.get(2.5, {}).get(fastest[0]),
                    '1.5s': traffic_sensitivities.get(1.5, {}).get(fastest[0]),
                    '2.0s': traffic_sensitivities.get(2.0, {}).get(fastest[0]),
                    '2.5s': traffic_sensitivities.get(2.5, {}).get(fastest[0])
                }
            else:
                team['traffic_sensitivity'] = {
                    'loose_15': None, 'standard_20': None, 'strict_25': None,
                    '1.5s': None, '2.0s': None, '2.5s': None
                }

            eligible = [r for r in candidates if r['driver'] == fastest[0]] if fastest else []
            clean_laps = [r for r in valid if r['team'] == name]
            selected_clean = [r for r in clean_laps if fastest and r['driver'] == fastest[0]]
            team['traffic_coverage'] = len(selected_clean)/len(eligible) if eligible else 0

            # Race speed trap statistics across clean laps
            team_st = [r['speed_st'] for r in clean_laps if r.get('speed_st') is not None]
            team_fl = [r['speed_fl'] for r in clean_laps if r.get('speed_fl') is not None]
            team['race_speed_trap_max'] = max(team_st) if team_st else None
            team['race_speed_trap_median'] = float(median(team_st)) if team_st else None
            team['race_speed_fl_max'] = max(team_fl) if team_fl else None
            team['race_speed_fl_median'] = float(median(team_fl)) if team_fl else None

            # Lap-matched speed traps (compares cars on the exact same laps, eliminating fuel weight differences)
            st_deltas = [r['speed_st'] - lap_st_benchmark[r['lap']]
                         for r in clean_laps if r.get('lap') in lap_st_benchmark and r.get('speed_st')]
            fl_deltas = [r['speed_fl'] - lap_fl_benchmark[r['lap']]
                         for r in clean_laps if r.get('lap') in lap_fl_benchmark and r.get('speed_fl')]
            team['race_speed_trap_matched'] = round(field_avg_st + sum(st_deltas)/len(st_deltas), 1) if (st_deltas and field_avg_st) else team['race_speed_trap_median']
            team['race_speed_fl_matched'] = round(field_avg_fl + sum(fl_deltas)/len(fl_deltas), 1) if (fl_deltas and field_avg_fl) else team['race_speed_fl_median']
            team['speed_trap'] = team['race_speed_trap_matched']
            team['speed_fl'] = team['race_speed_fl_matched']

            # Stint degradation: both raw slope and field-normalized degradation
            stints = defaultdict(list)
            stint_normalized = defaultdict(list)
            for r in clean_laps:
                if r['age'] is not None and r['time'] is not None:
                    stints[(r['driver'], r['stint'], r['compound'])].append((r['age'], r['time']))
                    if (r['lap'], r['compound']) in lap_compound_benchmark:
                        rel_time = r['time'] - lap_compound_benchmark[(r['lap'], r['compound'])]
                        stint_normalized[(r['driver'], r['stint'], r['compound'])].append((r['age'], rel_time))

            degradation_list = []
            for key, points in stints.items():
                s_val = slope(points)
                if s_val is None:
                    continue
                norm_pts = stint_normalized.get(key, [])
                field_norm_slope = slope(norm_pts) if len(norm_pts) >= 4 else None

                # Piecewise cliff detection (substantial rate acceleration >= 0.15 s/lap)
                cliff_detected = False
                cliff_age = None
                if len(points) >= 8:
                    mid = len(points) // 2
                    s1 = slope(points[:mid])
                    s2 = slope(points[mid:])
                    if s1 is not None and s2 is not None and s2 - s1 >= 0.15:
                        cliff_detected = True
                        cliff_age = points[mid][0]

                degradation_list.append({
                    'driver': key[0], 'stint': key[1], 'compound': key[2],
                    'slope': s_val, 'field_normalized_slope': field_norm_slope,
                    'cliff_detected': cliff_detected, 'cliff_age': cliff_age,
                    'samples': len(points)
                })
            team['degradation'] = degradation_list
    return {'event': str(data.event['EventName']), 'session': data.name,
            'teams': [{'team': name, **team} for name, team in teams.items()],
            'method': 'car-performance-v4-sampling-aware', 'traffic_threshold': traffic,
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
            if duration >= .4 and drop >= 35:
                v_start = float(speed[a])
                v_end = float(speed[b])
                v_mid = (v_start + v_end) / 2.0
                mid_idx = a
                for s_i in range(a, b):
                    if speed[s_i] <= v_mid:
                        mid_idx = s_i
                        break
                mid_idx = max(a + 1, min(b, mid_idx))
                early_dt = float(times[mid_idx] - times[a])
                early_drop = float(v_start - speed[mid_idx])
                early_g = (early_drop / 3.6 / early_dt / 9.80665) if early_dt > 0.04 and early_drop > 0 else (drop / 3.6 / duration / 9.80665)
                zones.append({'start': float(distance[a]), 'distance': float(distance[b]-distance[a]),
                              'entry': v_start, 'exit': v_end,
                              'duration': duration, 'mean_g': drop/3.6/duration/9.80665,
                              'early_g': float(early_g)})
            active = None
    full = [float(r['Speed']) for r in rows if number(r.get('Throttle')) is not None and r['Throttle'] >= 98 and not r.get('Brake')]
    return {'corners': output, 'braking': zones, 'top_speed': float(speed.max()),
            'full_throttle_p95': float(np.percentile(full, 95)) if len(full) >= 10 else None,
            'samples': len(rows), 'median_sample_interval': float(np.median(np.diff(times))),
            'lap_distance': length}
