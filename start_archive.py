"""Collect verified launch checkpoints from a completed Race or Sprint."""
from datetime import datetime, timedelta
import gzip
import json

from capture_storage import atomic_bytes, storage_lock
from start_execution import WINDOW_AFTER_START, WINDOW_BEFORE_START, standing_start


METHOD = 'start-execution-v1'
START_SESSIONS = {'Race', 'Sprint'}


def report_key(report):
    return report['year'], report['event'], report.get('session', 'Race')


def read_reports(path):
    try:
        payload = json.loads(path.read_text(encoding='utf-8'))
    except FileNotFoundError:
        return []
    if payload.get('method') != METHOD or not isinstance(payload.get('races'), list):
        raise ValueError(f'Unsupported start archive: {path}')
    return payload['races']


def opening_window(control):
    starts = [row for row in control if row.get('message') in {'RACE START', 'SPRINT START'}
              and row.get('lap_number') == 1]
    if not starts:
        starts = [row for row in control if row.get('category') == 'SessionStatus'
                  and row.get('message') == 'SESSION STARTED' and row.get('lap_number') in {None, 0, 1}]
    if len(starts) != 1:
        raise ValueError('Expected one confirmed first-lap start')
    start = datetime.fromisoformat(starts[0]['date'])
    if any((row.get('category') == 'SafetyCar' or row.get('flag') == 'RED')
           and abs((datetime.fromisoformat(row['date']) - start).total_seconds()) <= 5
           for row in control):
        raise ValueError('Race control shows a neutralized start')
    return start


def openf1_report(year, event, name, key, grid_source, start, grid, identities, samples):
    packets = {}
    for row in samples:
        stamp = datetime.fromisoformat(row['date'])
        seconds = (stamp - start).total_seconds()
        if -WINDOW_BEFORE_START <= seconds <= WINDOW_AFTER_START and row.get('brake') is not None and row.get('speed') is not None:
            packets.setdefault(row['driver_number'], []).append((stamp.timestamp(), row['speed'], bool(row['brake'])))
    drivers = {row['driver_number']: row for row in identities if row.get('name_acronym') and row.get('team_name')}
    standing = []
    for slot, number in sorted(grid.items()):
        driver = drivers.get(number)
        marks = standing_start(sorted(packets.get(number, [])))
        if driver and marks:
            standing.append(dict(driver=driver['name_acronym'], team=driver['team_name'], grid=slot, marks=marks))
    if not standing:
        raise ValueError('No launch window passed the stationarity and packet-gap checks')
    return dict(year=year, event=event, session=name, standing=standing, rolling=[],
                source=dict(provider='OpenF1', session_key=key, grid=grid_source))


def season_grid(data, year, round_number, name, identities):
    base = data / 'season'
    entry = json.loads((base / 'index.json').read_text(encoding='utf-8'))['entries'][f'/api/season?year={year}']
    with gzip.open(base / entry['file'], 'rt', encoding='utf-8') as source:
        season = json.load(source)
    race = next((row for row in season['rounds'] if row['round'] == round_number), {})
    codes = {row.get('name_acronym'): row['driver_number'] for row in identities}
    grid = {}
    for row in race.get(name.lower(), []):
        number = codes.get(season['drivers'].get(row['driver'], {}).get('code'))
        if number and isinstance(row.get('grid'), int) and row['grid'] > 0:
            grid[row['grid']] = number
    return grid


def capture_start(session, event, data, fetch, *, finish_confirmed=False):
    """Persist one report atomically, using the final grid or the settled Season classification."""
    year, name, key = int(session['year']), session['session_name'], session['session_key']
    event_name = event['name']
    target = data / 'starts' / f'{year}.json'
    previous = read_reports(target)
    identity = (year, event_name, name)
    bundled = read_reports(data / 'start-execution.json')
    if any(report_key(row) == identity or row.get('source', {}).get('session_key') == key
           for row in previous + bundled):
        return False

    def rows(endpoint, **filters):
        result = fetch(endpoint, session_key=key, **filters)
        if any(row.get('session_key') != key for row in result):
            raise ValueError(f'{endpoint} returned records for a different session')
        return result

    control = rows('race_control')
    if not finish_confirmed and not any(row.get('flag') == 'CHEQUERED' or row.get('message') == 'SESSION FINISHED' for row in control):
        raise ValueError('The race or Sprint finish is not confirmed')
    start = opening_window(control)
    drivers = rows('drivers')
    try:
        grid = {row['position']: row['driver_number'] for row in rows('starting_grid')
                if isinstance(row.get('position'), int) and row['position'] > 0}
    except (OSError, ValueError):
        grid = {}
    grid_source = 'OpenF1 starting grid'
    if not grid:
        grid = season_grid(data, year, event['round'], name, drivers)
        grid_source = 'Apex Season classification grid'
    if not grid:
        raise ValueError('The final starting grid is unavailable')
    samples = rows('car_data', **{
        'date>=': (start - timedelta(seconds=WINDOW_BEFORE_START)).isoformat(),
        'date<=': (start + timedelta(seconds=WINDOW_AFTER_START)).isoformat(),
    })
    report = openf1_report(year, event_name, name, key, grid_source, start, grid, drivers, samples)
    with storage_lock(target.parent):
        reports = [row for row in read_reports(target) if report_key(row) != identity] + [report]
        atomic_bytes(target, (json.dumps(dict(method=METHOD, races=reports), allow_nan=False, separators=(',', ':')) + '\n').encode())
    return True
