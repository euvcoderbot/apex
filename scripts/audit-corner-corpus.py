"""Offline before/after sanity audit; native corpus path is supplied explicitly.

This checks coverage, finiteness and phase additivity. It is NOT ground-truth
validation. Corpus files lack map markers, so mapped flat bends need a separate
captured-input replay (audit-corner-comparison.py).
"""
import argparse
import gzip
import json
import subprocess
import sys
import types
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import car_physics


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--before-ref', default='4f633cd')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    old = types.ModuleType('previous_car_physics')
    source = subprocess.check_output(['git', 'show', f'{args.before_ref}:car_physics.py'], cwd=ROOT)
    exec(compile(source, f'{args.before_ref}:car_physics.py', 'exec'), old.__dict__)
    reports = []
    for path in sorted(args.directory.glob('*.json.gz')):
        with gzip.open(path, 'rt', encoding='utf-8') as stream:
            data = json.load(stream)
        cars = {}
        for lap in sorted(data['laps'], key=lambda x: x['time']):
            s = lap['samples']
            cars.setdefault(lap['driver'], [np.column_stack([s[k] for k in ('d', 't', 'v', 'thr', 'brk', 'x', 'y', 'drs')])])
        if len(cars) < 3:
            continue
        report = {'year': data['year'], 'gp': data['gp'], 'drivers': len(cars)}
        for label, module in [('before', old), ('after', car_physics)]:
            result = module.speed_domain_metrics(cars)
            json.dumps(result, allow_nan=False)
            for corner in result.get('segments', {}).get('timed_corners', []):
                for value in corner['cars'].values():
                    assert abs(sum(value['phases_s'].values())-value['delta_s']) < 1e-8
            report[label] = {band: sum(car.get('cornering', {}).get(band, {}).get('index') is not None
                for car in result.get('cars', {}).values() if car.get('cornering', {}).get(band))
                for band in ('low', 'medium', 'high')}
        reports.append(report)
        print(json.dumps(report), flush=True)
    args.output.write_text(json.dumps({'checks': 'finite JSON, phase additivity, coverage; no map markers',
                                      'sessions': reports}, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
