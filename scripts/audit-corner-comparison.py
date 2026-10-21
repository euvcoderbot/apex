"""Replay native corner inputs and print an attributable driver comparison."""
import argparse
import gzip
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
import car_physics


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--year', type=int, default=2026)
    parser.add_argument('--gp', default='Bahrain Grand Prix')
    parser.add_argument('--drivers', nargs=2, default=['HAD', 'VER'])
    parser.add_argument('--input')
    parser.add_argument('--capture')
    parser.add_argument('--output')
    args = parser.parse_args()
    captured = {}
    projection = {}
    original_timing = car_physics.corner_timing
    def record_projection(projected, corners, track, field_speed):
        result = original_timing(projected, corners, track, field_speed)
        for corner in result[0]:
            start, end = corner['start_m'], corner['end_m']
            grid = np.linspace(start, end, max(2, int(end-start)+1))
            own = {}
            for name in args.drivers:
                if not projected.get(name):
                    continue
                a, p = projected[name][0]
                speed = np.interp(grid, p, a[:, car_physics.V])/3.6
                own[name] = {'speed_integral_s': float(np.trapezoid(1/speed, grid)),
                             'native_distance_m': float(np.interp(end,p,a[:,0])-np.interp(start,p,a[:,0])),
                             'end_bracket_s': float(np.max(np.diff(a[max(0,np.searchsorted(p,end)-1):np.searchsorted(p,end)+1,1])))
                             if 0 < np.searchsorted(p,end) < len(p) else None}
            projection[corner['corner']] = own
        return result
    car_physics.corner_timing = record_projection
    if args.input:
        with gzip.open(args.input, 'rt', encoding='utf-8') as stream:
            captured = json.load(stream)
        result = car_physics.speed_domain_metrics(
            {name: [np.asarray(a, float) for a in laps] for name, laps in captured['cars'].items()},
            captured['corners'])
    else:
        import server
        from fastapi import Response
        qualifying = server.car_performance(Response(), args.year, args.gp, 'Q', False)
        best = {}
        for team in qualifying['teams']:
            for lap in team.get('phase_details', []):
                if lap.get('time') and (lap['driver'] not in best or lap['time'] < best[lap['driver']]['time']):
                    best[lap['driver']] = lap
        windows = [{**p, 'team': name, 'team_name': name, 'driver_number': p['number'],
                    'qualifying_best_time': p['time'], 'qualifying_best_driver': name,
                    'qualifying_best_lap': p['lap']} for name, p in best.items()]
        original = car_physics.speed_domain_metrics
        def record(cars, corners=()):
            captured.update(year=args.year, gp=args.gp, selections=windows,
                            cars={n: [a.tolist() for a in laps] for n, laps in cars.items()}, corners=corners)
            return original(cars, corners)
        car_physics.speed_domain_metrics = record
        try:
            result = server.car_performance_trace_batch(Response(), args.year, args.gp,
                                                        json.dumps(windows), 'speed')['speed_domain']
        finally:
            car_physics.speed_domain_metrics = original
    if args.capture:
        with gzip.open(args.capture, 'wt', encoding='utf-8') as stream:
            json.dump(captured, stream, separators=(',', ':'))
    a, b = args.drivers
    evidence = []
    for corner in result.get('segments', {}).get('timed_corners', []):
        left, right = corner.get('cars', {}).get(a), corner.get('cars', {}).get(b)
        if left and right:
            evidence.append({**{k: v for k, v in corner.items() if k != 'cars'},
                             'difference_s': left['time_s']-right['time_s'],
                             'raw_difference_s': left['raw_delta_s']-right['raw_delta_s'],
                             a: left, b: right, 'projection_audit': projection.get(corner['corner'])})
    report = {'gp': captured.get('gp', args.gp), 'year': captured.get('year', args.year),
              'method': result.get('method'), 'drivers': args.drivers,
              'selections': [s for s in captured.get('selections', []) if s.get('driver') in args.drivers],
              'summary': {d: result.get('cars', {}).get(d, {}).get('cornering') for d in args.drivers},
              'corners': evidence, 'excluded': result.get('excluded'),
              'result_keys': list(result)}
    if args.output:
        Path(args.output).write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, separators=(',', ':')))


if __name__ == '__main__':
    main()
