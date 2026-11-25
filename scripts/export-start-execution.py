"""Build start measurements from a trusted FastF1 cache and archived OpenF1 windows.
Usage: python scripts/export-start-execution.py CACHE OUTPUT [--openf1 MANIFEST ...]
Each manifest specifies year, event, session_key, grid (car numbers by slot,
null for gaps), grid_source, and paths to race_control, drivers and car_data JSON.
Only the FastF1 instance owner's cache is suitable (its internal files use pickle).
"""
import argparse
import gzip
import json
import pickle
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from start_execution import WINDOW_AFTER_START, WINDOW_BEFORE_START, standing_start
from start_archive import opening_window, openf1_report, report_key


def cached(directory, key):
    with (directory / (key+'.ff1pkl')).open('rb') as source:
        return pickle.load(source)['data']


def inspect(directory, year, event, season):
    cars = cached(directory, 'car_data')
    status = cached(directory, 'session_status_data')
    flags = cached(directory, 'track_status_data')
    changes = [(t.total_seconds(), flag) for t, flag in zip(flags['Time'], flags['Status'])]
    first = next((t.total_seconds() for t, s in zip(status['Time'], status['Status']) if s == 'Started'), None)
    drivers = cached(directory, 'driver_info')
    grid = {season['drivers'][r['driver']]['code']: r.get('grid') for r in event['race'] if r['driver'] in season['drivers']}
    rows, rolling = [], []
    boundaries = [stamp for (_, before), (stamp, after) in zip(changes, changes[1:]) if before == '4' and after == '1']
    green_grid = first is not None and next((f for t,f in reversed(changes) if t <= first),'') == '1'
    if green_grid:
        green_grid = not any(f in ('4','5','6','7') for t,f in changes if first-5 <= t <= first+5)
    for number, frame in cars.items():
        driver = drivers.get(number, {})
        code = driver.get('Tla')
        if not code:
            continue
        # Time can repeat across a packet bundle. Date is the native car clock.
        # Session Time locates the broad window. All integration uses Date.
        clock = frame.Time.dt.total_seconds()
        identity = dict(driver=code, team=driver['TeamName'])
        if green_grid and grid.get(code) and grid[code] > 0:
            native = frame.loc[(clock >= first-WINDOW_BEFORE_START) & (clock <= first+WINDOW_AFTER_START)]
            points = [(r.Date.timestamp(), float(r.Speed), bool(r.Brake)) for r in native.itertuples() if r.Source == 'car']
            result = standing_start(points)
            if result:
                rows.append(dict(**identity, grid=grid[code], marks=result))
        for i, boundary in enumerate(boundaries, 1):
            # Context only: observe native speeds near SC -> green. No assumption
            # the leader accelerated when race control changed the flag.
            speeds = []
            for offset in (0, 2, 4):
                error = (clock-boundary-offset).abs()
                near = frame.loc[(error == error.min()) & (error <= .65)]
                near = near.loc[near.Source == 'car']
                speeds.append(round(float(near.Speed.median())) if len(near) else None)
            if all(v is not None and v > 0 for v in speeds):
                rolling.append(dict(**identity, release=i, speeds=speeds))
    return dict(year=year, event=event['name'], standing=rows, rolling=rolling)


def inspect_openf1(manifest_path):
    """Replay an archived OpenF1 race with a verified final grid."""
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    session_key = manifest['session_key']

    def read_rows(key):
        rows = json.loads((manifest_path.parent / manifest[key]).read_text(encoding='utf-8'))
        if not rows or any(row['session_key'] != session_key for row in rows):
            raise ValueError(f'{key} must contain records for race session {session_key}')
        return rows

    control = read_rows('race_control')
    race_start = opening_window(control)
    grid = {i: number for i, number in enumerate(manifest['grid'], 1) if number is not None}
    return openf1_report(manifest['year'], manifest['event'], manifest.get('session', 'Race'),
                         session_key, manifest['grid_source'], race_start, grid,
                         read_rows('drivers'), read_rows('car_data'))


def main():
    args = argparse.ArgumentParser()
    args.add_argument('cache', type=Path)
    args.add_argument('output', type=Path)
    args.add_argument('--openf1', type=Path, action='append', default=[],
                      help='Archived race manifest with OpenF1 JSON paths and a verified grid in slot order')
    paths = args.parse_args()
    base = ROOT/'assets/data/season'
    index = json.loads((base/'index.json').read_text())['entries']
    reports = []
    for file in sorted(paths.cache.glob('*/*/*_Race/car_data.ff1pkl')):
        year = int(file.parents[2].name)
        season = json.loads(gzip.decompress((base/index[f'/api/season?year={year}']['file']).read_bytes()))
        date = file.parent.name[:10]
        event = next((r for r in season['rounds'] if r['date'] == date), None)
        if event:
            reports.append(inspect(file.parent, year, event, season))
    for manifest in paths.openf1:
        try:
            report = inspect_openf1(manifest)
        except ValueError as error:
            print(f'{manifest}: {error}', file=sys.stderr)
            metadata = json.loads(manifest.read_text(encoding='utf-8'))
            report = dict(year=metadata['year'], event=metadata['event'], session=metadata.get('session', 'Race'),
                          standing=[], rolling=[], unavailable=str(error),
                          source=dict(provider='OpenF1', session_key=metadata['session_key'], grid=metadata['grid_source']))
            if any(report_key(race) == report_key(report) and race['standing'] for race in reports):
                continue
        reports = [race for race in reports if report_key(race) != report_key(report)]
        reports.append(report)
    paths.output.write_text(json.dumps(dict(method='start-execution-v1', races=reports),allow_nan=False,separators=(',',':'))+'\n',encoding='utf-8',newline='\n')


if __name__ == '__main__':
    main()
