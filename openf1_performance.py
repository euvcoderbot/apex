"""Validated public timing fallback; no invented lap times, tyres or flags."""
from datetime import datetime
from types import SimpleNamespace
import math
import re
import gzip
import hashlib
import json
from pathlib import Path
import time


def retained_bundle(year, gp, code, now=None):
    """Exact, expiring completed-session inputs, never previously calculated scores."""
    path = Path(__file__).with_name('openf1-performance.json.gz')
    if not path.exists():
        return None
    with gzip.open(path, 'rt', encoding='utf-8') as stream:
        record = json.load(stream).get(f'{year}:{gp}:{code}')
    if not record or record['expires'] <= (time.time() if now is None else now):
        return None
    bundle = record['bundle']
    digest = hashlib.sha256(json.dumps(bundle, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    if digest != record['sha256']:
        raise ValueError('Retained OpenF1 source checksum mismatch')
    adapt_performance(year, gp, code, bundle)
    return bundle


def number(value):
    try:
        value = float(value)
        return value if math.isfinite(value) else None
    except (TypeError, ValueError):
        return None


def stamp(value):
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return parsed.timestamp() if parsed.tzinfo else None
    except (TypeError, ValueError):
        return None


def adapt_performance(year, gp, code, bundle):
    session = bundle['session']
    expected = {'Q': 'Qualifying', 'R': 'Race'}[code]
    if session.get('year') != year or session.get('session_name') != expected:
        raise ValueError('OpenF1 fallback session identity mismatch')
    key = session['session_key']
    for rows in bundle['feeds'].values():
        if any(r.get('session_key') not in (None, key) or
               r.get('meeting_key') not in (None, session.get('meeting_key')) for r in rows):
            raise ValueError('OpenF1 fallback contains another session')
    feeds = bundle['feeds']
    results = {str(r['driver_number']): r for r in feeds['session_result']}
    controls = sorted((r for r in feeds['race_control'] if stamp(r.get('date')) is not None), key=lambda r: stamp(r['date']))
    weather = [(stamp(r.get('date')), r) for r in feeds['weather'] if stamp(r.get('date')) is not None]
    origin = stamp(session.get('date_start'))
    if origin is None or not feeds['laps'] or not results:
        raise ValueError('OpenF1 fallback lacks timing/classification')

    # Race-control intervals are conservative: any sector yellow excludes the
    # whole lap. SC IN THIS LAP is not green; only a published track clear or
    # green closes the neutralised interval. Unknown controls never mean green.
    active, blocked, deleted = {}, [], set()
    for r in controls:
        t, category, flag, scope = stamp(r['date']), r.get('category'), r.get('flag'), r.get('scope')
        message = r.get('message', '').upper()
        if 'DELETED' in message or 'REINSTATED' in message:
            driver = re.search(r'CAR\s+(\d+)\b', message)
            lap = re.search(r'\bLAP\s+(\d+)\b', message)
            if driver and lap:
                pair = (driver.group(1), int(lap.group(1)))
                if 'REINSTATED' in message:
                    deleted.discard(pair)
                else:
                    deleted.add(pair)
        name = None
        if category == 'SafetyCar' and 'DEPLOYED' in message:
            name = 'neutralised'
        elif category == 'Flag' and scope in ('Track', 'Sector') and flag in ('YELLOW', 'DOUBLE YELLOW', 'RED'):
            name = (scope, r.get('sector'))
        if name is not None:
            active.setdefault(name, t)
        if category == 'Flag' and flag in ('GREEN', 'CLEAR'):
            names = list(active) if scope == 'Track' else [(scope, r.get('sector'))]
            for name in names:
                if name in active:
                    blocked.append((active.pop(name), t))
    blocked.extend((start, float('inf')) for start in active.values())
    pits = {(str(r['driver_number']), int(r['lap_number'])) for r in feeds['pit'] if r.get('lap_number')}
    for r in feeds['laps']:
        if r.get('is_pit_out_lap') and number(r.get('lap_number')):
            pits.add((str(r['driver_number']), int(r['lap_number']) - 1))

    infos, rows = {}, []
    for driver in feeds['drivers']:
        number_id = str(driver['driver_number'])
        result = results.get(number_id)
        if not result or not driver.get('name_acronym') or not driver.get('team_name'):
            continue
        name = driver['name_acronym']
        status = 'Disqualified' if result.get('dsq') else 'Did not start' if result.get('dns') else 'Retired' if result.get('dnf') else 'Finished'
        info = {'Abbreviation': name, 'DriverNumber': number_id, 'TeamName': driver['team_name'],
                'TeamColor': driver.get('team_colour'), 'Position': result.get('position'),
                'Status': status, 'Points': result.get('points'), 'Laps': result.get('number_of_laps')}
        durations = result.get('duration')
        if code == 'Q' and isinstance(durations, list):
            info.update({f'Q{i+1}': number(value) for i, value in enumerate(durations[:3])})
        infos[name] = info
        stints = [r for r in feeds['stints'] if str(r['driver_number']) == number_id]
        for lap in (r for r in feeds['laps'] if str(r['driver_number']) == number_id):
            lap_no, duration, start = number(lap.get('lap_number')), number(lap.get('lap_duration')), stamp(lap.get('date_start'))
            if lap_no is None:
                continue
            lap_no = int(lap_no)
            end = start + duration if start is not None and duration is not None else None
            sectors = [number(lap.get(f'duration_sector_{i}')) for i in (1, 2, 3)]
            consistent = bool(duration and all(s is not None and s > 0 for s in sectors) and abs(sum(sectors)-duration) <= .006)
            stint = next((s for s in stints if s.get('lap_start') is not None and s.get('lap_end') is not None
                          and s['lap_start'] <= lap_no <= s['lap_end']), {})
            age = number(stint.get('tyre_age_at_start'))
            age = age + lap_no-stint['lap_start']+1 if age is not None else None
            nearby = min(weather, key=lambda w: abs(w[0]-(start+duration/2))) if weather and start is not None and duration else None
            rain = bool(nearby[1]['rainfall']) if nearby and abs(nearby[0]-(start+duration/2)) <= 120 and nearby[1].get('rainfall') is not None else None
            phase = None
            if code == 'Q':
                matches = [f'Q{i}' for i in (1, 2, 3) if info.get(f'Q{i}') is not None and duration is not None and abs(info[f'Q{i}']-duration) < .005]
                events = [r for r in controls if start is not None and stamp(r['date']) <= start and r.get('qualifying_phase') in (1, 2, 3)]
                phase = f"Q{events[-1]['qualifying_phase']}" if events else matches[-1] if matches else None
            legal = (number_id, lap_no) not in deleted
            pit = bool(lap.get('is_pit_out_lap') or (number_id, lap_no) in pits)
            track = '1' if controls and start is not None and end is not None and not any(a < end and b > start for a, b in blocked) else ''
            rows.append({'driver': name, 'number': number_id, 'team': driver['team_name'], 'lap': lap_no,
                         'time': duration, 'start': start-origin if start is not None else None,
                         'end': end-origin if end is not None else None, 'compound': str(stint.get('compound') or 'UNKNOWN').upper(),
                         'age': age, 'fresh': None, 'stint': stint.get('stint_number'), 'phase': phase,
                         'pit': pit, 'accurate': consistent and legal and start is not None and not pit,
                         'deleted': not legal, 'track': track, 'rain': rain, 'sectors': sectors,
                         'speed_st': number(lap.get('st_speed')), 'speed_fl': None,
                         'speed_i1': number(lap.get('i1_speed')), 'speed_i2': number(lap.get('i2_speed')),
                         'date_start': lap.get('date_start'), 'timing_source': 'OpenF1'})
    if not rows or not infos:
        raise ValueError('OpenF1 fallback has no identified timing rows')
    return SimpleNamespace(name=expected, year=year, event={'EventName': gp}, drivers=list(infos),
                           get_driver=infos.__getitem__, _QUALI_LIKE_SESSIONS=('Qualifying',), apex_recorded_rows=rows)
