"""Each Grand Prix's fastest qualifying lap of a season, from OpenF1, for seasons without published telemetry.

scripts/build-track-profiles.mjs builds the Tracks section from the published qualifying telemetry (assets/data/telemetry),
which exists only for the seasons the site captures. For earlier seasons this writes the same inputs from OpenF1 (free
historical data from 2023), the way capture-openf1-qualifying.py reads it, and before 2023 from FastF1 (F1's own timing
archive, which needs a signed-in F1 account: FastF1 asks for the email and password in the terminal once and keeps the
token): per Grand Prix, the session's fastest lap that Race Control did not delete, as samples (Distance from the integrated
speed, ElapsedSeconds, Speed, Throttle, Brake, nGear, and X, Y from the location feed interpolated onto the car data), with
a last sample at the official lap time; and the facts the builder reads (circuit key, location, the lap's sector times
and the weather nearest the lap). Pirelli's nominated compounds are not in OpenF1 and are left out.

Writes .apex-cache/track-laps/<year>.json (not committed; the builder turns it into assets/data/track-profiles/<year>.json).
Usage: .venv/Scripts/python.exe scripts/export-quali-laps.py 2023 2024 2025   (OpenF1)
       .venv/Scripts/python.exe scripts/export-quali-laps.py 2018 2019 2020 2021 2022   (FastF1, signed in)
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / '.apex-cache' / 'track-laps'


def get(path, **q):
    url = 'https://api.openf1.org/v1/' + path + '?' + urllib.parse.urlencode(q, safe='<>=:')
    for attempt in range(10):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'apex-data-track-build'})
            with urllib.request.urlopen(req, timeout=60) as r:
                time.sleep(.6)
                return json.load(r)
        except Exception as e:
            if getattr(e, 'code', None) == 404:
                return []
            retry = getattr(e, 'headers', None) and e.headers.get('Retry-After')
            time.sleep(float(retry) if retry else min(60, 5 * (attempt + 1)))
    raise RuntimeError('failed ' + url)


def ts(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).isoformat()


def lap_seconds(text):
    m = re.search(r'TIME (\d+):(\d+\.\d+)', text or '')
    return int(m.group(1)) * 60 + float(m.group(2)) if m else None


def fastest_valid(laps, deleted):
    for lap in sorted(laps, key=lambda l: l['lap_duration']):
        if not any(n == lap['driver_number'] and abs(t - lap['lap_duration']) < .0015 for n, t in deleted):
            return lap
    return None


def export(year):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f'{year}.json'
    done = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {'year': year, 'events': {}}
    meetings = {m['meeting_key']: m for m in get('meetings', year=year)}
    sessions = [s for s in get('sessions', year=year, session_name='Qualifying')
                if ts(s['date_end']) < time.time() - 86400 and not s.get('is_cancelled')]
    for s in sessions:
        meeting = meetings.get(s['meeting_key']) or {}
        gp = meeting.get('meeting_name') or s['location']
        if gp in done['events'] or 'testing' in gp.lower():
            continue
        try:
            key = s['session_key']
            drivers = {d['driver_number']: d for d in get('drivers', session_key=key)}
            laps = [l for l in get('laps', session_key=key) if l.get('lap_duration') and l.get('date_start') and not l.get('is_pit_out_lap')]
            deleted = []
            for m in get('race_control', session_key=key):
                text = m.get('message') or ''
                if 'DELETED' in text and m.get('driver_number') and lap_seconds(text):
                    deleted.append((m['driver_number'], lap_seconds(text)))
            lap = fastest_valid(laps, deleted)
            if not lap:
                print(f'{year} {gp:30} no timed lap', flush=True)
                continue
            num, dur = lap['driver_number'], lap['lap_duration']
            t0 = ts(lap['date_start'])
            t1 = t0 + dur
            window = {'date>': iso(t0 - 1), 'date<': iso(t1 + 1)}
            car = get('car_data', session_key=key, driver_number=num, **window)
            loc = get('location', session_key=key, driver_number=num, **window)
            if len(car) < 100 or len(loc) < 50:
                print(f'{year} {gp:30} too little telemetry ({len(car)} car, {len(loc)} location)', flush=True)
                continue
            car = [c for c in car if t0 <= ts(c['date']) <= t1]
            ct = np.array([ts(c['date']) for c in car])
            lt = np.array([ts(p['date']) for p in loc])
            v = np.array([c['speed'] for c in car], float)
            # A first and last sample at the lap's start and its official time, so the lap measures exactly its duration.
            ct = np.r_[t0, ct, t1]
            v = np.r_[v[0], v, v[-1]]
            src = [car[0]] + car + [car[-1]]
            dist = np.r_[0, np.cumsum(np.diff(ct) * (v[1:] + v[:-1]) / 2 / 3.6)]
            xs = np.interp(ct, lt, [p['x'] for p in loc])
            ys = np.interp(ct, lt, [p['y'] for p in loc])
            samples = [{'Distance': round(float(d), 1), 'ElapsedSeconds': round(float(t - t0), 3), 'Speed': float(sp),
                        'Throttle': c.get('throttle'), 'Brake': 1 if (c.get('brake') or 0) > 0 else 0, 'nGear': c.get('n_gear'),
                        'X': round(float(x)), 'Y': round(float(y))}
                       for d, t, sp, c, x, y in zip(dist, ct, v, src, xs, ys)]
            row = {'time': round(dur, 3), 's1': lap.get('duration_sector_1'), 's2': lap.get('duration_sector_2'), 's3': lap.get('duration_sector_3')}
            weather = get('weather', session_key=key)
            if weather:
                near = min(weather, key=lambda w: abs(ts(w['date']) - t0))
                row['conditions'] = {'air_temperature': near.get('air_temperature'), 'track_temperature': near.get('track_temperature'),
                                     'rainfall': bool(near.get('rainfall'))}
            code = (drivers.get(num) or {}).get('name_acronym') or str(num)
            done['events'][gp] = {
                'driver': code, 'lap': lap.get('lap_number'), 'samples': samples,
                'session': {'circuit_key': s.get('circuit_key'), 'location': s.get('location'), 'compounds': None,
                            'drivers': [{'code': code, 'laps': [row]}]},
            }
            path.write_text(json.dumps(done, separators=(',', ':')), encoding='utf-8')
            print(f'{year} {gp:30} {code} {dur:.3f}s, {len(samples)} samples, {len(deleted)} deleted laps skipped', flush=True)
        except Exception as e:  # one unavailable session should not stop the season
            print(f'{year} {gp:30} failed: {type(e).__name__}: {e}', flush=True)
    path.write_text(json.dumps(done, separators=(',', ':')), encoding='utf-8')


def export_fastf1(year):
    """The same export from FastF1 (seasons before OpenF1's archive). FastF1's fastest lap skips deleted laps."""
    import fastf1
    fastf1.Cache.enable_cache(str(ROOT / '.fastf1-cache'))
    fastf1.set_log_level('WARNING')
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f'{year}.json'
    done = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {'year': year, 'events': {}}
    secs = lambda td: td.total_seconds() if td is not None and hasattr(td, 'total_seconds') and td == td else None
    from fastf1.exceptions import RateLimitExceededError

    def waiting(call):
        # FastF1 allows 500 requests an hour per process: wait for the window to free up rather than stop.
        for _ in range(8):
            try:
                return call()
            except RateLimitExceededError:
                print(f'{year} FastF1 request limit reached, waiting 10 minutes', flush=True)
                time.sleep(600)
        return call()

    for _, ev in waiting(lambda: fastf1.get_event_schedule(year, include_testing=False)).iterrows():
        gp = ev['EventName']
        if gp in done['events']:
            continue
        try:
            session = fastf1.get_session(year, gp, 'Qualifying')
            waiting(lambda: session.load(laps=True, telemetry=True, weather=True, messages=False))
            lap = session.laps.pick_fastest()
            if lap is None or getattr(lap, 'empty', False):
                print(f'{year} {gp:30} no timed lap', flush=True)
                continue
            dur = secs(lap['LapTime'])
            tel = lap.get_telemetry()
            samples = []
            for _, p in tel.iterrows():
                t = secs(p['Time'])
                if t is None or not np.isfinite(p['Speed']):
                    continue
                samples.append({'Distance': round(float(p['Distance']), 1), 'ElapsedSeconds': round(t, 3), 'Speed': float(p['Speed']),
                                'Throttle': float(p['Throttle']), 'Brake': 1 if bool(p['Brake']) else 0,
                                'nGear': int(p['nGear']) if np.isfinite(p['nGear']) else None,
                                'X': round(float(p['X'])) if np.isfinite(p['X']) else None, 'Y': round(float(p['Y'])) if np.isfinite(p['Y']) else None})
            if len(samples) < 100 or not dur:
                print(f'{year} {gp:30} too little telemetry', flush=True)
                continue
            # End the lap at its official time, as the OpenF1 export does.
            last = samples[-1]
            if dur > last['ElapsedSeconds']:
                samples.append({**last, 'Distance': round(last['Distance'] + last['Speed'] / 3.6 * (dur - last['ElapsedSeconds']), 1), 'ElapsedSeconds': round(dur, 3)})
            row = {'time': round(dur, 3), 's1': secs(lap['Sector1Time']), 's2': secs(lap['Sector2Time']), 's3': secs(lap['Sector3Time'])}
            w = session.weather_data
            if w is not None and len(w) and lap['LapStartTime'] is not None:
                near = w.iloc[(w['Time'] - lap['LapStartTime']).abs().argsort()[:1]].iloc[0]
                row['conditions'] = {'air_temperature': float(near['AirTemp']), 'track_temperature': float(near['TrackTemp']), 'rainfall': bool(near['Rainfall'])}
            info = session.session_info or {}
            meeting = info.get('Meeting', {})
            done['events'][gp] = {
                'driver': lap['Driver'], 'lap': int(lap['LapNumber']), 'samples': samples,
                'session': {'circuit_key': meeting.get('Circuit', {}).get('Key'), 'location': meeting.get('Location') or ev['Location'],
                            'compounds': None, 'drivers': [{'code': lap['Driver'], 'laps': [row]}]},
            }
            path.write_text(json.dumps(done, separators=(',', ':')), encoding='utf-8')
            print(f'{year} {gp:30} {lap["Driver"]} {dur:.3f}s, {len(samples)} samples', flush=True)
        except Exception as e:
            print(f'{year} {gp:30} failed: {type(e).__name__}: {e}', flush=True)
    path.write_text(json.dumps(done, separators=(',', ':')), encoding='utf-8')


if __name__ == '__main__':
    for y in sys.argv[1:] or ['2025']:
        (export(int(y)) if int(y) >= 2023 else export_fastf1(int(y)))
