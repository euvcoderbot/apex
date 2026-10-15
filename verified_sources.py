"""Read-only, identity-checked recordings of completed sessions.

These are source observations, never cached performance scores. Recovered
observations run through the current calculations; missing fields stay unknown.
"""
import copy
import gzip
import json
import time
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from types import SimpleNamespace


@lru_cache(maxsize=1)
def _recordings():
    path = Path(__file__).with_name('verified-sources.json.gz')
    if not path.exists():
        return {}
    with gzip.open(path, 'rt', encoding='utf-8') as stream:
        return json.load(stream).get('sessions', {})


def recorded_session(year, gp, session, now=None):
    code = {'Qualifying':'Q', 'Race':'R'}.get(session, session)
    record = _recordings().get(f'{year}:{gp}:{code}')
    if not record or record['expires'] <= (time.time() if now is None else now):
        return None
    data = record['data']
    if (record['year'] != year or data.get('event') != gp
            or data.get('session') != {'Q':'Qualifying','R':'Race'}.get(code)
            or not data.get('lap_data_complete') or not data.get('drivers')):
        return None
    return record


def source_notice(record):
    return {'kind':'verified-recording', 'captured_at':record['captured_at'],
            'recorded_session_date':record['data']['date'],
            'source_sha256':record['source_sha256'],
            'expires_at':datetime.fromtimestamp(record['expires'], timezone.utc).isoformat(),
            'message':'Using retained completed-session source observations; live archive availability is not guaranteed. Calculated with the current methodology.'}


def recorded_payload(record):
    return {**copy.deepcopy(record['data']), 'source_cache':source_notice(record)}


def recorded_lap(record, driver=None, number=None, lap=None, start=None, end=None, duration=None):
    for item in record.get('telemetry', []):
        s = item['selection']
        if driver and s['driver'] != driver.upper():
            continue
        if number and str(s['driver_number']) != str(number):
            continue
        if lap is not None and int(s['lap']) != int(lap):
            continue
        if start is not None and abs(s['start']-start) > .005:
            continue
        if end is not None and abs(s['end']-end) > .005:
            continue
        if duration is not None and abs(s['time']-duration) > .005:
            continue
        return item
    return None


def performance_input(record):
    """Adapt captured fields, without inventing freshness, weather or flags."""
    data = record['data']
    rows, infos = [], {}
    for driver in data['drivers']:
        code = driver['code']
        result = driver.get('result') or {}
        info = {'Abbreviation':code, 'DriverNumber':driver['number'],
                'TeamName':driver['team'], 'TeamColor':driver.get('team_color'),
                'Position':driver.get('position'), 'Status':result.get('status'),
                'Points':result.get('points'), 'Time':result.get('gap')}
        for lap in driver.get('laps', []):
            observed = recorded_lap(record, driver=code, lap=lap['lap'])
            selected = observed['selection'] if observed else {}
            rows.append({'driver':code, 'number':str(driver['number']), 'team':driver['team'],
                         'lap':lap['lap'], 'time':lap.get('time'),
                         'start':lap.get('lap_start_seconds'), 'end':lap.get('lap_end_seconds'),
                         'compound':lap.get('compound'), 'age':lap.get('tyre_life'),
                         'fresh':lap.get('fresh_tyre', selected.get('fresh')),
                         'stint':lap.get('stint'), 'phase':lap.get('phase'),
                         'pit':bool(lap.get('in_lap') or lap.get('out_lap')),
                         'accurate':lap.get('accurate') is True, 'deleted':lap.get('deleted') is True,
                         'track':lap.get('track_status'), 'rain':(lap.get('conditions') or {}).get('rainfall'),
                         'sectors':[lap.get('s1'),lap.get('s2'),lap.get('s3')],
                         **{key:lap.get(key,selected.get(key)) for key in ('speed_st','speed_fl','speed_i1','speed_i2')}})
        for phase in ('Q1','Q2','Q3'):
            info[phase] = min((r['time'] for r in rows if r['driver']==code and r['phase']==phase
                               and r['time'] and r['accurate'] and not r['pit'] and not r['deleted']), default=None)
        infos[code] = info
    return SimpleNamespace(name=data['session'], year=record['year'], event={'EventName':data['event']},
                           _QUALI_LIKE_SESSIONS=('Qualifying',), drivers=list(infos),
                           get_driver=infos.__getitem__, apex_recorded_rows=rows)
