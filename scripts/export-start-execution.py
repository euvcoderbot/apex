"""Build a local review dataset from a trusted, locally generated FastF1 cache.
Usage: python scripts/export-start-execution.py CACHE OUTPUT
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
from start_execution import standing_start


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
            native = frame.loc[(clock >= first-4) & (clock <= first+14)]
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


def main():
    args = argparse.ArgumentParser()
    args.add_argument('cache', type=Path)
    args.add_argument('output', type=Path)
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
    paths.output.write_text(json.dumps(dict(method='start-execution-v1', races=reports),allow_nan=False,separators=(',',':'))+'\n',encoding='utf-8',newline='\n')


if __name__ == '__main__':
    main()
