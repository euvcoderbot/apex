"""Compare qualifying telemetry coverage on the retained native trace corpus."""
import gzip
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from car_physics import speed_domain_metrics


def run(laps, repeated):
    cars, timing = defaultdict(list), defaultdict(list)
    seen = Counter()
    for lap in sorted(laps, key=lambda row: row['time']):
        team = lap['team']
        driver = lap['driver']
        key = (team, driver) if repeated else team
        if seen[key]:
            continue
        seen[key] += 1
        channels = lap['samples']
        cars[team].append(np.column_stack([channels[k] for k in ('d','t','v','thr','brk','x','y','drs')]).astype(float))
        timing[team].append({'official_time_s':lap['time'], 'driver':driver, 'lap':lap['lap']})
    return speed_domain_metrics(cars, lap_info=timing).get('cars', {})


def coverage(cars):
    counts = Counter()
    for car in cars.values():
        for key in ('traction','straight_mid','straight_top','track_straights','braking'):
            row = car.get(key) or {}
            counts[key] += row.get('index') is not None
        for band in ('low','medium','high'):
            row = car.get('cornering', {}).get(band) or {}
            counts['corner_'+band] += row.get('index') is not None
    return counts


if __name__ == '__main__':
    year = sys.argv[1] if len(sys.argv) > 1 else '*'
    total = {name: Counter() for name in ('single','paired_drivers')}
    weekends = {name: Counter() for name in total}
    for path in sorted((ROOT/'data/val').glob(year+'-*.json.gz')):
        with gzip.open(path) as source:
            laps = json.load(source)['laps']
        result = {name: coverage(run(laps, name != 'single')) for name in total}
        for name, counts in result.items():
            total[name].update(counts)
            weekends[name].update(key for key, count in counts.items() if count >= 3)
        print(json.dumps({'session':path.stem, **result}), flush=True)
    print(json.dumps({'team_weekends':total, 'weekends_with_field':weekends}))
