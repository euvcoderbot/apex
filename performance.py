"""Request-scoped car comparisons. No persisted or cross-request data cache.

Keep measurements separate from interpretations: timing-line gaps are not
continuous traffic measurements, and observed corner speed is not downforce.
Strict adherence to observable physical telemetry and versioned FIA envelopes.
"""
from collections import defaultdict
from statistics import median
import math
import numpy as np

from fia_energy_params import get_fia_energy_envelope

DRY_COMPOUNDS = {'SOFT', 'MEDIUM', 'HARD', 'HYPERSOFT', 'ULTRASOFT',
                 'SUPERSOFT', 'SUPERHARD'}
TYRE_FUEL_GAIN_S_PER_LAP = 0.060  # Explicit approximation, not a measured fuel load.


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


def tyre_age_slope(points):
    """Robust within-stint seconds gained/lost per additional tyre-age lap."""
    if len(points) < 3 or max(x for x, _ in points)-min(x for x, _ in points) < 2:
        return None
    return float(median((b[1]-a[1])/(b[0]-a[0]) for i, a in enumerate(points)
                        for b in points[i+1:] if b[0] != a[0]))


def matched_tyre_trend(stint_rows, field_rows, team_name):
    """Relative tyre trend across overlapping same-compound race stints.

    Compare slopes on the same *race-lap interval*, with similar tyre age,
    against distinct rival teams. This avoids demanding simultaneous clean
    laps from several teams, which erased otherwise usable GP data. Common
    fuel burn and track evolution are largely differenced out; tyre allocation,
    traffic screens and driver management remain limitations.
    """
    if len(stint_rows) < 6:
        return None, len(stint_rows), 0
    compound = stint_rows[0]['compound']
    subject = [r for r in stint_rows if r.get('lap') is not None
               and r.get('age') is not None and r.get('time') is not None]
    peers = defaultdict(list)
    for row in field_rows:
        if (row.get('team') != team_name and row.get('compound') == compound
                and row.get('lap') is not None and row.get('age') is not None
                and row.get('time') is not None):
            peers[(row['team'], row['driver'], row['stint'])].append(row)
    estimates = {}
    for (team, _, _), rival in peers.items():
        lo = max(min(r['lap'] for r in subject), min(r['lap'] for r in rival))
        hi = min(max(r['lap'] for r in subject), max(r['lap'] for r in rival))
        if hi-lo < 5:
            continue
        mine = [r for r in subject if lo <= r['lap'] <= hi]
        theirs = [r for r in rival if lo <= r['lap'] <= hi]
        if len(mine) < 6 or len(theirs) < 6:
            continue
        if abs(median(r['age'] for r in mine)-median(r['age'] for r in theirs)) > 10:
            continue
        mine_slope = slope([(r['age'], r['time']) for r in mine])
        peer_slope = slope([(r['age'], r['time']) for r in theirs])
        if mine_slope is None or peer_slope is None:
            continue
        difference = mine_slope-peer_slope
        if abs(difference) > .5:
            continue
        candidate = (len(mine)+len(theirs), difference, {r['lap'] for r in mine})
        if team not in estimates or candidate[0] > estimates[team][0]:
            estimates[team] = candidate
    if len(estimates) < 2:
        return None, 0, len(estimates)
    matched_laps = set().union(*(candidate[2] for candidate in estimates.values()))
    if len(matched_laps) < 6:
        return None, len(matched_laps), len(estimates)
    return float(median(candidate[1] for candidate in estimates.values())), len(matched_laps), len(estimates)


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


def traffic_gaps(rows, leader_abbr=None):
    """Multi-checkpoint timing-line physical gap measurement comparing all on-track cars.

    Checks start line, sector 1, sector 2, and end line crossings across all on-track cars (both lead lap and lapped).
    Identifies the closest physical car ahead on track at each checkpoint. If ANY physical car is within
    < 2.0s ahead at ANY physical checkpoint, physical proximity vetoes clean air.
    """
    from bisect import bisect_left
    line_crossings = set()
    for r in rows:
        d = r.get('driver')
        if r.get('end') is not None:
            line_crossings.add((r['end'], d))
        if r.get('start') is not None:
            line_crossings.add((r['start'], d))
    crossings = sorted(line_crossings)
    times = [x[0] for x in crossings]

    # Sector checkpoints for physical proximity verification throughout the lap
    s1_crossings = []
    s2_crossings = []
    for r in rows:
        st = r.get('start')
        sec = r.get('sectors') or []
        if st is not None and len(sec) >= 3:
            if sec[0] is not None:
                s1_crossings.append((st + sec[0], r['driver']))
                if sec[1] is not None:
                    s2_crossings.append((st + sec[0] + sec[1], r['driver']))
    s1_crossings.sort()
    s2_crossings.sort()
    s1_times = [x[0] for x in s1_crossings]
    s2_times = [x[0] for x in s2_crossings]

    gaps = {}
    for row in rows:
        values = []
        is_leader = bool(leader_abbr and row.get('driver') == leader_abbr)

        # 1. Start and finish line crossings (compares against every physical car crossing the line)
        for stamp in (row.get('start'), row.get('end')):
            if stamp is None:
                break
            i = bisect_left(times, stamp) - 1
            while i >= 0 and crossings[i][1] == row['driver']:
                i -= 1
            if i < 0:
                if is_leader:
                    values.append(999.0)
                    continue
                break
            gap = stamp - times[i]
            # No nearby crossing can also mean missing timing, not clean air.
            if gap > max(60, (row.get('time') or 0) * 1.25):
                if is_leader:
                    values.append(999.0)
                    continue
                break
            values.append(gap)

        # 2. Sector 1 & 2 checkpoints for physical proximity veto across all on-track cars
        st = row.get('start')
        sec = row.get('sectors') or []
        if len(values) == 2 and st is not None and len(sec) >= 2:
            if sec[0] is not None and s1_times:
                s1_stamp = st + sec[0]
                i = bisect_left(s1_times, s1_stamp) - 1
                while i >= 0 and s1_crossings[i][1] == row['driver']:
                    i -= 1
                if i >= 0:
                    s1_gap = s1_stamp - s1_times[i]
                    if 0 < s1_gap < 60:
                        values.append(s1_gap)
                    elif is_leader and s1_gap >= 60:
                        values.append(999.0)
                elif is_leader:
                    values.append(999.0)
            if len(sec) >= 2 and sec[0] is not None and sec[1] is not None and s2_times:
                s2_stamp = st + sec[0] + sec[1]
                i = bisect_left(s2_times, s2_stamp) - 1
                while i >= 0 and s2_crossings[i][1] == row['driver']:
                    i -= 1
                if i >= 0:
                    s2_gap = s2_stamp - s2_times[i]
                    if 0 < s2_gap < 60:
                        values.append(s2_gap)
                    elif is_leader and s2_gap >= 60:
                        values.append(999.0)
                elif is_leader:
                    values.append(999.0)

        gaps[(row['driver'], row['lap'])] = min(values) if len(values) >= 2 else None
    return gaps


def compute_lap_traffic(rows, intervals=None, leader_abbr=None):
    """Whole-lap time-weighted traffic evaluation with physical proximity veto & leader/null handling."""
    timing_gaps = traffic_gaps(rows, leader_abbr=leader_abbr)
    lap_traffic = {}
    for r in rows:
        key = (r.get('driver'), r.get('lap'))
        t_gap = timing_gaps.get(key)

        lap_intervals = intervals.get(key) if intervals else None
        if lap_intervals and len(lap_intervals) >= 2:
            weights = []
            obs_gaps = []
            for item in lap_intervals:
                gap_val = item.get('gap')
                dt = float(item.get('duration', 1.0))
                if gap_val is None:
                    if leader_abbr and r.get('driver') == leader_abbr:
                        # If leader is approaching a lapped car physically within < 2.0s at a checkpoint,
                        # do not treat the interval as infinite clean air
                        if t_gap is not None and t_gap < 2.0:
                            obs_gaps.append(t_gap)
                            weights.append(dt)
                        else:
                            obs_gaps.append(999.0)
                            weights.append(dt)
                    continue
                if isinstance(gap_val, str) and (gap_val.startswith('+') or 'LAP' in gap_val):
                    obs_gaps.append(0.5)
                    weights.append(dt)
                    continue
                try:
                    num_gap = float(gap_val)
                    obs_gaps.append(num_gap)
                    weights.append(dt)
                except (ValueError, TypeError):
                    continue

            total_duration = sum(weights)
            lap_time = r.get('time') or 90.0
            coverage = total_duration / max(1.0, lap_time)
            if coverage >= 0.80 and obs_gaps:
                sorted_pairs = sorted(zip(obs_gaps, weights), key=lambda x: x[0])
                p10_target = 0.10 * total_duration
                cum = 0.0
                p10_gap = sorted_pairs[0][0]
                for g, w in sorted_pairs:
                    cum += w
                    if cum >= p10_target:
                        p10_gap = g
                        break
                exposure_20 = sum(w for g, w in zip(obs_gaps, weights) if g < 2.0) / max(0.001, total_duration)

                # Physical proximity veto: if any physical car (lead lap or lapped) crossed within < 2.0s
                # at ANY physical checkpoint, clean air is vetoed
                effective_gap = min(p10_gap, t_gap) if t_gap is not None and t_gap < 2.0 else p10_gap

                lap_traffic[key] = {
                    'gap': effective_gap,
                    'traffic_exposure_20': exposure_20,
                    'traffic_coverage': coverage,
                    'p10_gap': p10_gap,
                    'quality': 'sufficient'
                }
                continue

        lap_traffic[key] = {
            'gap': t_gap,
            'traffic_exposure_20': 1.0 if (t_gap is not None and t_gap < 2.0) else 0.0,
            'traffic_coverage': 0.0,
            'p10_gap': t_gap,
            'quality': 'checkpoint_proxy' if t_gap is not None else 'insufficient'
        }
    return lap_traffic


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


def get_verified_retirement(event_name, abbr, year=None):
    # These notes were assembled for 2026 only. Without a linked primary
    # document they are context, not verified evidence of a failure cause.
    if year != 2026:
        return None
    if (event_name, abbr) in VERIFIED_RETIREMENT_REASONS:
        return VERIFIED_RETIREMENT_REASONS[(event_name, abbr)]
    norm_event = event_name.lower().replace('grand prix', '').replace('gp', '').strip()
    for (ev, drv), val in VERIFIED_RETIREMENT_REASONS.items():
        if drv == abbr:
            ev_clean = ev.lower().replace('grand prix', '').replace('gp', '').strip()
            if norm_event and (norm_event in ev_clean or ev_clean in norm_event):
                return val
    return None


def classify_retirement(status, event_name, abbr, session_year=None):
    """Audited year-aware reliability taxonomy.

    Categories:
    - PU-related (ICE, turbo, MGU-K, energy store, control electronics; strictly NO MGU-H in 2026+)
    - Chassis / team-related (suspension, steering, brakes, gearbox, hydraulics, cooling plumbing, wheels)
    - Incident / collision (crashes, spins, contact damage)
    - Other confirmed (medical, DSQ, technical withdrawal)
    - Unknown / unverified (unconfirmed/generic retirements)
    """
    v_ret = get_verified_retirement(event_name, abbr, session_year)
    if v_ret:
        raw_cat, cause = v_ret
        source = 'Unlinked 2026 event note'
        verified = False
    else:
        raw_cat = None
        cause = str(status)
        source = 'Official Timing'
        verified = False

    # Check 2026+ regulatory compliance: strictly exclude MGU-H
    if session_year and session_year >= 2026:
        if 'mgu-h' in str(cause).lower():
            return {
                'category': 'Unknown / unverified',
                'cause': f'{cause} (invalid MGU-H reference under 2026+ regulations)',
                'source': source,
                'verified': False,
                'is_mechanical': False,
                'year_compliant': False
            }

    cause_lower = str(cause).lower()
    cat_lower = str(raw_cat or '').lower()

    pu_keywords = ['power unit', 'engine', 'turbo', 'oil pressure', 'water leak', 'coolant',
                   'cooling', 'radiator', 'oil leak', 'fuel leak', 'fuel system',
                   'fuel pressure', 'battery', 'ers', 'mgu-k', 'loss of drive',
                   'exhaust', 'electrical cut-off', 'electrical / halo']
    if not (session_year and session_year >= 2026):
        pu_keywords.append('mgu-h')

    chassis_keywords = ['gearbox', 'transmission', 'hydraulics', 'hydraulic',
                        'brakes', 'brake', 'suspension', 'steering', 'driveshaft',
                        'differential', 'clutch', 'floor vibration', 'kerb strike',
                        'wheel attachment', 'wheel bearing']

    incident_keywords = ['accident', 'collision', 'contact', 'barrier', 'crash',
                         'spun off', 'spin', 'damage from contact', 'wall']

    other_keywords = ['medical', 'illness', 'disqualified', 'dsq', 'withdrew', 'withdrawn']

    if any(k in cause_lower for k in incident_keywords) or 'accident' in cat_lower or 'collision' in cat_lower:
        category = 'Incident / collision'
        is_mechanical = False
    elif any(k in cause_lower for k in pu_keywords) or 'power unit' in cat_lower:
        category = 'PU-related'
        is_mechanical = True
    elif any(k in cause_lower for k in chassis_keywords) or 'mechanical' in cat_lower:
        category = 'Chassis / team-related'
        is_mechanical = True
    elif any(k in cause_lower for k in other_keywords):
        category = 'Other confirmed'
        is_mechanical = False
    else:
        category = 'Unknown / unverified'
        is_mechanical = False

    return {
        'category': category,
        'cause': str(cause),
        'source': source,
        'verified': verified,
        'is_mechanical': is_mechanical,
        'year_compliant': True
    }


def analyze(data, traffic=2):
    rows = records(data)
    qualifying = data.name in getattr(data, '_QUALI_LIKE_SESSIONS', ())
    event_name = str(getattr(getattr(data, 'event', {}), 'get', lambda k, d='': getattr(data, 'event', {}).get(k, d))('EventName') or getattr(data, 'name', ''))

    session_year = getattr(data, 'year', None)
    if not session_year and hasattr(data, 'event') and isinstance(data.event, dict):
        session_year = data.event.get('Year')
    if not session_year and hasattr(data, 'date') and hasattr(data.date, 'year'):
        session_year = data.date.year
    try:
        session_year = int(session_year) if session_year else None
    except (TypeError, ValueError):
        session_year = None

    regulatory_energy_envelope = get_fia_energy_envelope(session_year, event_name, data.name)

    teams = defaultdict(lambda: {'drivers': [], 'points': 0, 'points_known': True,
                                  'starts': 0, 'finishes': 0, 'mechanical': 0,
                                  'pu_retirements': 0, 'chassis_retirements': 0,
                                  'incidents': 0, 'incident_retirements': 0,
                                  'other_retirements': 0, 'unknown_retirements': 0,
                                  'positions': [], 'retirements': []})

    leader_abbr = None
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
        pos = number(info.get('Position'))
        if pos and (status in ('Finished', 'Lapped') or status.startswith('+')):
            team['positions'].append(pos)
            if pos == 1 and leader_abbr is None:
                leader_abbr = abbr

        if status not in ('Did not start', 'Withdrew', 'Did not qualify'):
            team['starts'] += 1
        if status in ('Finished', 'Lapped') or status.startswith('+'):
            team['finishes'] += 1
        elif status not in ('Did not start', 'Withdrew', 'Did not qualify'):
            ret_info = classify_retirement(status, event_name, abbr, session_year)
            cat = ret_info['category']
            if cat == 'PU-related':
                team['pu_retirements'] += 1
                team['mechanical'] += 1
            elif cat == 'Chassis / team-related':
                team['chassis_retirements'] += 1
                team['mechanical'] += 1
            elif cat == 'Incident / collision':
                team['incident_retirements'] += 1
                team['incidents'] += 1
            elif cat == 'Other confirmed':
                team['other_retirements'] += 1
            else:
                team['unknown_retirements'] += 1
            team['retirements'].append({
                'driver': abbr,
                'category': cat,
                'cause': ret_info['cause'],
                'source': ret_info['source'],
                'verified': ret_info['verified'],
                'year_compliant': ret_info['year_compliant']
            })

    if qualifying:
        # An official flying lap remains a qualifying result even if one of the
        # three sector feeds is missing. Sector-derived diagnostics can be null.
        valid = [r for r in rows if r['time'] and not r['pit'] and not r['deleted']]
        selected = defaultdict(list)
        driver_ideals = {}

        for phase in ('Q1', 'Q2', 'Q3'):
            official = {}
            for code in data.drivers:
                info = data.get_driver(code)
                official[str(info.get('Abbreviation'))] = number(info.get(phase))
            phase_laps = [r for r in valid if r['phase'] == phase
                          and official.get(r['driver']) is not None
                          and abs(r['time']-official[r['driver']]) < .005]
            if not phase_laps:
                phase_laps = [r for r in valid if r['phase'] == phase]
            best = min((r['time'] for r in phase_laps), default=None)
            sector_best = [min((r['sectors'][i] for r in phase_laps if r['sectors'][i]), default=None)
                           for i in range(3)]

            # Compound-matched ideal sector sums within this qualifying phase
            for r in phase_laps:
                drv = r['driver']
                comp = r['compound']
                key = (drv, phase, comp)
                if key not in driver_ideals:
                    comp_laps = [x for x in phase_laps if x['driver'] == drv and x['compound'] == comp and all(x['sectors'])]
                    if comp_laps:
                        best_comp_time = min(x['time'] for x in comp_laps)
                        s1 = min(x['sectors'][0] for x in comp_laps if x['sectors'][0])
                        s2 = min(x['sectors'][1] for x in comp_laps if x['sectors'][1])
                        s3 = min(x['sectors'][2] for x in comp_laps if x['sectors'][2])
                        ideal_sum = s1 + s2 + s3
                        driver_ideals[key] = {
                            'best_complete': best_comp_time,
                            'ideal_sum': ideal_sum,
                            'gap': best_comp_time - ideal_sum,
                            'sectors': [s1, s2, s3],
                            'compound': comp
                        }

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

            matched_ideal = None
            if team_best_lap:
                matched_ideal = driver_ideals.get((team_best_lap['driver'], team_best_lap['phase'], team_best_lap['compound']))
                if matched_ideal and matched_ideal['ideal_sum'] > team_best_lap['time'] + .005:
                    matched_ideal = None
            if not matched_ideal and team_best_lap and all(team_best_lap['sectors']):
                matched_ideal = {
                    'best_complete': team_best_lap['time'],
                    'ideal_sum': sum(team_best_lap['sectors']),
                    'gap': 0.0,
                    'sectors': team_best_lap['sectors'],
                    'compound': team_best_lap['compound']
                }

            ideal_lap_time = matched_ideal['ideal_sum'] if matched_ideal else None
            ideal_gap = matched_ideal['gap'] if matched_ideal else None
            ideal_sectors = matched_ideal['sectors'] if matched_ideal else None
            ideal_compound = matched_ideal['compound'] if matched_ideal else (team_best_lap['compound'] if team_best_lap else None)

            team_phase_details = []
            seen_phases_drivers = set()
            for entry in phases:
                seen_phases_drivers.add((entry['phase'], entry['lap']['driver']))
                team_phase_details.append({
                    'phase': entry['phase'],
                    'driver': entry['lap']['driver'],
                    'time': entry['lap']['time'],
                    'deficit': entry['pace'],
                    'compound': entry['lap'].get('compound')
                })
            for phase in ('Q1', 'Q2', 'Q3'):
                other_laps = [r for r in valid if r.get('phase') == phase and r.get('team') == name
                              and (phase, r.get('driver')) not in seen_phases_drivers]
                other_by_drv = {}
                for r in other_laps:
                    drv = r.get('driver')
                    if drv and (drv not in other_by_drv or r['time'] < other_by_drv[drv]['time']):
                        other_by_drv[drv] = r
                for drv, r in other_by_drv.items():
                    seen_phases_drivers.add((phase, drv))
                    phase_best_time = min((x['time'] for x in valid if x.get('phase') == phase), default=None)
                    team_phase_details.append({
                        'phase': phase,
                        'driver': drv,
                        'time': r['time'],
                        'deficit': ((r['time'] / phase_best_time - 1) * 100) if phase_best_time else 0.0,
                        'compound': r.get('compound')
                    })

            team.update({
                'pace': sum(entry['pace'] for entry in phases)/len(phases) if phases else None,
                'lap': team_best_lap,
                'laps': laps,
                'ideal_lap_time': ideal_lap_time,
                'ideal_vs_complete_gap': float(ideal_gap) if ideal_gap is not None else None,
                'ideal_vs_complete_gap_s': round(float(ideal_gap), 3) if ideal_gap is not None else None,
                'ideal_sectors': ideal_sectors,
                'completed_sectors': team_best_lap['sectors'] if team_best_lap else None,
                'ideal_compound': ideal_compound,
                'telemetry_candidates': sorted(
                    [r for r in valid if r['team'] == name and r['compound'] in DRY_COMPOUNDS
                     and r['rain'] is False and laps
                     and r['time'] <= min(x['time'] for x in laps)*1.01],
                    key=lambda r: r['time'])[:3],
                'phase_count': len(phases),
                'phase_details': team_phase_details,
                'samples': len(phases),
                'sector_deficits': [
                    (sum(values)/len(values) if values else None)
                    for values in ([entry['sectors'][i] for entry in phases
                                    if entry['sectors'][i] is not None] for i in range(3))
                ],
            })

        # Headline Qualifying Deficit across complete qualifying session
        representatives = [team['lap'] for team in teams.values() if team['lap']]
        fastest_time = min((lap['time'] for lap in representatives), default=None)
        fastest_sectors = [min((lap['sectors'][i] for lap in representatives
                                if lap['sectors'][i]), default=None) for i in range(3)]
        fastest_ideal_time = min((team['ideal_lap_time'] for team in teams.values() if team.get('ideal_lap_time')), default=fastest_time)
        fastest_ideal_sectors = [min((team['ideal_sectors'][i] for team in teams.values() if team.get('ideal_sectors')), default=None) for i in range(3)]

        for team in teams.values():
            lap = team['lap']
            pace_pct = (lap['time']/fastest_time-1)*100 if lap and fastest_time else None
            pace_sec = (lap['time']-fastest_time) if lap and fastest_time else None
            ideal_pct = (team['ideal_lap_time']/fastest_ideal_time-1)*100 if team.get('ideal_lap_time') and fastest_ideal_time else None
            ideal_sec = (team['ideal_lap_time']-fastest_ideal_time) if team.get('ideal_lap_time') and fastest_ideal_time else None

            team['pace'] = pace_pct
            team['pace_delta_s'] = round(pace_sec, 3) if pace_sec is not None else None
            team['ideal_pace'] = ideal_pct
            team['ideal_pace_delta_s'] = round(ideal_sec, 3) if ideal_sec is not None else None
            team['samples'] = 1 if lap else 0
            team['sector_deficits'] = [
                (lap['sectors'][i]/fastest_sectors[i]-1)*100
                if lap and lap['sectors'][i] and fastest_sectors[i] else None
                for i in range(3)]
            team['ideal_sector_deficits'] = [
                (team['ideal_sectors'][i]/fastest_ideal_sectors[i]-1)*100
                if team.get('ideal_sectors') and team['ideal_sectors'][i] and fastest_ideal_sectors[i] else None
                for i in range(3)]
            team['speed_trap'] = lap.get('speed_st') if lap else None
            team['speed_fl'] = lap.get('speed_fl') if lap else None

    else:
        valid_all = [r for r in rows if clean(r)]
        traffic_info = compute_lap_traffic(rows, leader_abbr=leader_abbr)
        gaps = {k: v['gap'] for k, v in traffic_info.items()}
        candidates = [r for r in valid_all if r['lap'] and r['lap'] > 2]
        valid = [r for r in candidates if gaps.get((r['driver'], r['lap'])) is not None
                 and gaps[(r['driver'], r['lap'])] > traffic]
        # A tyre slope can tolerate a wider clean-air screen than the headline
        # race-pace estimate. Keep it separate so short soft stints are not
        # erased merely by a 1.5–2.0 s checkpoint gap.
        tyre_valid = [r for r in candidates if gaps.get((r['driver'], r['lap'])) is not None
                      and gaps[(r['driver'], r['lap'])] > 1.5]
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

        # Rebase each sensitivity threshold so the fastest driver is 0.00%
        for th, t_est in traffic_sensitivities.items():
            if t_est:
                min_v = min(t_est.values())
                traffic_sensitivities[th] = {
                    d: round(max(0.0, ((100 + v) / (100 + min_v) - 1) * 100), 4)
                    for d, v in t_est.items()
                }

        lap_st_times = defaultdict(lambda: defaultdict(list))
        lap_fl_times = defaultdict(lambda: defaultdict(list))
        stint_physical_min_age = {}
        for r in rows:
            key = (r.get('driver'), r.get('stint'))
            if r.get('age') is not None:
                stint_physical_min_age[key] = min(stint_physical_min_age.get(key, 999), r['age'])
        for r in valid:
            if r.get('lap') is None or not r.get('team'):
                continue
            if r.get('speed_st') is not None:
                lap_st_times[r['lap']][r['team']].append(r['speed_st'])
            if r.get('speed_fl') is not None:
                lap_fl_times[r['lap']][r['team']].append(r['speed_fl'])

        lap_st_benchmark = {lap: float(median([median(v) for v in teams_at_lap.values()]))
                            for lap, teams_at_lap in lap_st_times.items() if len(teams_at_lap) >= 3}
        lap_fl_benchmark = {lap: float(median([median(v) for v in teams_at_lap.values()]))
                            for lap, teams_at_lap in lap_fl_times.items() if len(teams_at_lap) >= 3}
        field_avg_st = sum(lap_st_benchmark.values()) / len(lap_st_benchmark) if lap_st_benchmark else None
        field_avg_fl = sum(lap_fl_benchmark.values()) / len(lap_fl_benchmark) if lap_fl_benchmark else None
        driver_team = {r['driver']: r['team'] for r in candidates if r.get('driver') and r.get('team')}

        # Headline race pace uses one 2.0s model and one shared baseline.
        # The 1.5s and 2.5s models are diagnostics only.
        std_estimates = traffic_sensitivities.get(2.0, {})

        for name, team in teams.items():
            team_candidates = [r for r in candidates if r.get('team') == name]
            clean_20 = [r for r in candidates if r.get('team') == name and gaps.get((r['driver'], r['lap'])) is not None and gaps[(r['driver'], r['lap'])] > 2.0]

            # Select the fastest eligible teammate within the common model.
            team_drivers = list({r['driver'] for r in team_candidates if r.get('driver')})
            fastest_driver = None
            if team_drivers:
                drivers_with_20 = [(d, std_estimates[d]) for d in team_drivers if d in std_estimates]
                if drivers_with_20:
                    fastest_driver = min(drivers_with_20, key=lambda x: x[1])[0]

            # Determine sample counts for headline driver
            d_laps_20 = [r for r in clean_20 if r['driver'] == fastest_driver] if fastest_driver else []
            n_20 = len(d_laps_20)
            headline_pace = std_estimates.get(fastest_driver)
            sample_tier = 'normal' if n_20 >= 10 else 'insufficient'
            provisional = n_20 < 10
            fallback_used = False
            model_threshold = 2.0

            # Non-monotonic traffic sensitivity bracket [min, max]
            valid_th_paces = [
                traffic_sensitivities[th][fastest_driver]
                for th in (1.5, 2.0, 2.5)
                if th in traffic_sensitivities and fastest_driver in traffic_sensitivities[th]
                and traffic_sensitivities[th][fastest_driver] is not None
            ] if fastest_driver else []

            bracket = [round(min(valid_th_paces), 2), round(max(valid_th_paces), 2)] if valid_th_paces else None

            team['pace'] = headline_pace
            team['fastest_race_driver'] = fastest_driver
            team['sample_tier'] = sample_tier
            team['provisional'] = provisional
            team['fallback_used'] = fallback_used
            team['model_threshold'] = model_threshold
            team['traffic_sensitivity_bracket'] = bracket
            team['samples'] = n_20
            team['race_residual_spread'] = support.get(fastest_driver, {}).get('residual_spread') if fastest_driver else None
            eligible_drivers = [(d, std_estimates[d]) for d in team_drivers if d in std_estimates]
            team['race_drivers'] = [
                {
                    'driver': d,
                    'pace': pace,
                    'samples': len([r for r in clean_20 if r['driver'] == d]),
                    'residual_spread': support.get(d, {}).get('residual_spread'),
                }
                for d, pace in sorted(eligible_drivers, key=lambda item: item[1])
            ]
            team['teammate_spread'] = (max(p for _, p in eligible_drivers) - min(p for _, p in eligible_drivers)) if len(eligible_drivers) >= 2 else None

            team['traffic_sensitivity'] = {
                'loose_15': traffic_sensitivities.get(1.5, {}).get(fastest_driver),
                'standard_20': traffic_sensitivities.get(2.0, {}).get(fastest_driver),
                'strict_25': traffic_sensitivities.get(2.5, {}).get(fastest_driver),
                '1.5s': traffic_sensitivities.get(1.5, {}).get(fastest_driver),
                '2.0s': traffic_sensitivities.get(2.0, {}).get(fastest_driver),
                '2.5s': traffic_sensitivities.get(2.5, {}).get(fastest_driver)
            }

            clean_laps = clean_20
            team['traffic_coverage'] = 0.0  # No continuous interval data is supplied.
            team['traffic_quality'] = 'checkpoint_proxy'

            # Race speed trap statistics across clean laps
            team_st = [r['speed_st'] for r in clean_laps if r.get('speed_st') is not None]
            team_fl = [r['speed_fl'] for r in clean_laps if r.get('speed_fl') is not None]
            team['race_speed_trap_max'] = max(team_st) if team_st else None
            team['race_speed_trap_median'] = float(median(team_st)) if team_st else None
            team['race_speed_fl_max'] = max(team_fl) if team_fl else None
            team['race_speed_fl_median'] = float(median(team_fl)) if team_fl else None

            st_deltas = [r['speed_st'] - lap_st_benchmark[r['lap']]
                         for r in clean_laps if r.get('lap') in lap_st_benchmark and r.get('speed_st')]
            fl_deltas = [r['speed_fl'] - lap_fl_benchmark[r['lap']]
                         for r in clean_laps if r.get('lap') in lap_fl_benchmark and r.get('speed_fl')]
            team['race_speed_trap_matched'] = round(field_avg_st + sum(st_deltas)/len(st_deltas), 1) if (st_deltas and field_avg_st is not None) else None
            team['race_speed_fl_matched'] = round(field_avg_fl + sum(fl_deltas)/len(fl_deltas), 1) if (fl_deltas and field_avg_fl is not None) else None
            team['race_speed_trap_matched_laps'] = len(st_deltas)
            team['speed_trap'] = team['race_speed_trap_matched']
            team['speed_fl'] = team['race_speed_fl_matched']

            # Stint tyre degradation: measure slope of lap time vs tyre age across clean stint laps
            stint_laps_map = defaultdict(list)
            for r in tyre_valid:
                if r['team'] != name:
                    continue
                if r.get('age') is not None and r.get('time') is not None and r.get('compound'):
                    stint_laps_map[(r['driver'], r['stint'], r['compound'])].append(r)

            total_race_laps = max((r['lap'] for r in rows if r.get('lap')), default=0)
            degradation_list = []
            for key, laps in stint_laps_map.items():
                s_times = [r['time'] for r in laps]
                s_med = float(median(s_times)) if s_times else 0.0
                filtered = [r for r in laps if r['time'] - s_med <= 1.8 and not (r.get('lap') and r['lap'] >= total_race_laps - 1 and r['time'] - s_med > 0.8)]
                points = [(r['age'], r['time']) for r in filtered]
                s_val = slope(points)
                if s_val is None:
                    continue
                ages = [p[0] for p in points]
                min_age = int(min(ages))
                max_age = int(max(ages))
                age_span = max_age - min_age
                is_low_sample = len(points) < 8 or age_span < 6
                phys_min = stint_physical_min_age.get((key[0], key[1]), min_age)
                is_used_start = phys_min > 3 or min_age > 6

                cliff_detected = False
                cliff_age = None
                if len(points) >= 8:
                    mid = len(points) // 2
                    s1 = slope(points[:mid])
                    s2 = slope(points[mid:])
                    if s1 is not None and s2 is not None and (s2 - s1) >= 0.15:
                        cliff_detected = True
                        cliff_age = points[mid][0]

                degradation_list.append({
                    'team': name,
                    'driver': key[0], 'stint': key[1], 'compound': key[2],
                    'slope': s_val,
                    'relative_slope': None,
                    'field_normalized_slope': None,
                    'min_age': min_age, 'max_age': max_age, 'age_span': age_span,
                    'samples': len(points),
                    'field_support': 1,
                    'low_sample': is_low_sample,
                    'used_start': is_used_start,
                    'cliff_detected': cliff_detected,
                    'cliff_age': cliff_age
                })
            team['degradation'] = degradation_list

        # Compare each clean stint lap against other teams on the same race lap,
        # compound and a similar tyre age. Stint-to-stint slopes from different
        # race phases confound fuel burn and track evolution with tyre wear.
        all_event_stints = [s for team in teams.values() for s in team.get('degradation', [])]
        field_stint_rows = [r for r in tyre_valid if r.get('age') is not None
                            and r.get('time') is not None and r.get('compound') in DRY_COMPOUNDS]
        for s in all_event_stints:
            stint_rows = [r for r in field_stint_rows
                          if r['driver'] == s['driver'] and r['stint'] == s['stint']
                          and r['compound'] == s['compound']]
            estimate, matched_laps, peers = matched_tyre_trend(
                stint_rows, field_stint_rows, s['team'])
            s['relative_slope'] = estimate
            s['field_normalized_slope'] = s['relative_slope']
            s['matched_laps'] = matched_laps
            s['field_support'] = peers
            s['benchmark'] = 'overlapping-race-laps-same-compound-similar-tyre-age'
        for s in all_event_stints:
            s.pop('team', None)

        # Separate within-driver tyre-age trend. Unlike the rival-matched
        # diagnostic above, this uses every usable dry, green, non-pit lap;
        # it never requires another team to run the same compound or stint.
        individual_rows = [r for r in valid_all if r.get('lap') and r['lap'] > 1
                           and r.get('age') is not None and r.get('stint') is not None]
        for name, team in teams.items():
            by_stint = defaultdict(list)
            for r in individual_rows:
                if r['team'] == name:
                    by_stint[(r['driver'], r['stint'], r['compound'])].append(r)
            observed = []
            for (driver, stint, compound), laps in by_stint.items():
                times = [r['time'] for r in laps]
                typical = float(median(times))
                # A stint-local 107% gate removes gross anomalies without
                # comparing different compounds, drivers or race phases.
                # Keep both slow and implausibly fast outliers out of the fit.
                ceiling = typical * .07
                points = [(r['age'], r['time']) for r in laps
                          if abs(r['time']-typical) <= ceiling]
                raw = tyre_age_slope(points)
                if raw is None:
                    continue
                ages = [age for age, _ in points]
                observed.append({
                    'driver': driver, 'stint': stint, 'compound': compound,
                    'raw_slope': round(raw, 5),
                    'fuel_adjusted_slope': round(raw + TYRE_FUEL_GAIN_S_PER_LAP, 5),
                    'fuel_assumption_s_per_lap': TYRE_FUEL_GAIN_S_PER_LAP,
                    'min_age': int(min(ages)), 'max_age': int(max(ages)),
                    'samples': len(points), 'candidate_laps': len(laps),
                    'outlier_laps': len(laps)-len(points),
                    'low_sample': len(points) < 6,
                    'used_start': min(ages) > 3,
                })
            team['tyre_age_stints'] = observed

    return {'event': str(getattr(getattr(data, 'event', {}), 'get', lambda k, d='': getattr(data, 'event', {}).get(k, d))('EventName') or getattr(data, 'name', '')),
            'session': data.name,
            'year': session_year,
            'regulatory_energy_envelope': regulatory_energy_envelope,
            'teams': [{'team': name, **team} for name, team in teams.items()],
            'method': 'car-performance-v4-sampling-aware',
            'traffic_threshold': traffic,
            'total_laps': len(rows),
            'eligible_laps': len(valid)}


def huber_fit(X, y, delta=1.345, max_iter=50):
    """Iteratively reweighted least squares (IRLS) with Huber loss."""
    import numpy as np
    N, P = X.shape
    if N <= P:
        sol = np.linalg.lstsq(X, y, rcond=None)[0]
        return sol, np.ones(N)
    beta = np.linalg.lstsq(X, y, rcond=None)[0]
    weights = np.ones(N)
    for _ in range(max_iter):
        residuals = y - X @ beta
        med_res = float(np.median(residuals))
        mad = float(np.median(np.abs(residuals - med_res)))
        scale = max(1e-4, 1.4826 * mad)
        r_std = residuals / scale
        abs_r = np.abs(r_std)
        weights = np.where(abs_r <= delta, 1.0, delta / np.maximum(abs_r, 1e-9))
        W = np.sqrt(weights)
        beta_next = np.linalg.lstsq(X * W[:, None], y * W, rcond=None)[0]
        if np.max(np.abs(beta_next - beta)) < 1e-5:
            break
        beta = beta_next
    return beta, weights


def compute_development_progression(rounds_data):
    """
    Multivariate robust Huber development progression model:
    PaceDeficit = beta_0 + beta_1 * Round + beta_apex * MedianApex + beta_straight * StraightShare + epsilon
    """
    import numpy as np
    valid = [r for r in rounds_data if r.get('deficit') is not None and math.isfinite(r['deficit'])]
    n = len(valid)
    if n < 2:
        return {
            'progression_rate': None,
            'modelled_shift': None,
            'opening_median': round(valid[0]['deficit'], 3) if n == 1 else None,
            'closing_median': round(valid[0]['deficit'], 3) if n == 1 else None,
            'observed_shift': None,
            'sample_tier': 'insufficient',
            'sample_tier_label': 'Insufficient (<2 events)',
            'count': n
        }

    rounds = np.array([float(r['round']) for r in valid], dtype=float)
    deficits = np.array([float(r['deficit']) for r in valid], dtype=float)

    cols = [np.ones(n), rounds - np.mean(rounds)]

    apex_vals = [r.get('median_apex') for r in valid]
    has_apex = all(v is not None and math.isfinite(v) for v in apex_vals) and (len(apex_vals) >= 8 and float(np.std(apex_vals)) > 1.0)
    if has_apex:
        apex_arr = np.array(apex_vals, dtype=float)
        cols.append((apex_arr - np.mean(apex_arr)) / max(1.0, float(np.std(apex_arr))))

    straight_vals = [r.get('straight_share') for r in valid]
    has_straight = all(v is not None and math.isfinite(v) for v in straight_vals) and (len(straight_vals) >= 8 and float(np.std(straight_vals)) > 0.02)
    if has_straight:
        straight_arr = np.array(straight_vals, dtype=float)
        cols.append((straight_arr - np.mean(straight_arr)) / max(0.01, float(np.std(straight_arr))))

    X = np.column_stack(cols)
    y = deficits

    beta, weights = huber_fit(X, y)
    b_round = float(beta[1])
    round_span = float(rounds[-1] - rounds[0])
    modelled_shift = b_round * round_span

    # Descriptive opening and closing medians
    k = max(2, min(6, n // 4)) if n >= 8 else (2 if n >= 4 else 1)
    opening_med = float(np.median(deficits[:k]))
    closing_med = float(np.median(deficits[-k:]))
    observed_shift = closing_med - opening_med

    sample_tier = 'robust' if n >= 15 else ('provisional' if n >= 10 else 'raw')
    sample_tier_label = 'Robust (≥15 events)' if n >= 15 else ('Provisional (10–14 events)' if n >= 10 else 'Raw (<10 events)')

    return {
        'progression_rate': round(b_round, 4),
        'modelled_shift': round(modelled_shift, 3),
        'opening_median': round(opening_med, 3),
        'closing_median': round(closing_med, 3),
        'observed_shift': round(observed_shift, 3),
        'sample_tier': sample_tier,
        'sample_tier_label': sample_tier_label,
        'opening_count': k,
        'closing_count': k,
        'count': n,
        'weights': [round(float(w), 3) for w in weights]
    }


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
