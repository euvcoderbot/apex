"""Offline retrieval-shape and processing regression checks; no data cache involved."""
import ast
from datetime import datetime, timedelta, timezone
from pathlib import Path
import subprocess
import sys
import time
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pandas as pd
import server
from fastapi import Response


class RetrievalTests(unittest.TestCase):
    def test_slow_positions_do_not_block_ready_car_data(self):
        start = datetime(2026,9,12,14,10,tzinfo=timezone.utc)
        release = threading.Event()
        def upstream(endpoint, **params):
            if endpoint == 'location':
                release.wait(8)
                return []
            return [{'date':(start+timedelta(seconds=i/4)).isoformat(), 'speed':200,
                     'throttle':100,'brake':0,'n_gear':6,'rpm':10000,'drs':0} for i in range(241)]
        try:
            with patch.object(server, 'openf1', upstream):
                began=time.perf_counter()
                samples=server._openf1_lap_telemetry.__wrapped__(2026,'Spanish Grand Prix','Q','3',17,0,
                    11365,start.isoformat(),60,None)
                self.assertLess(time.perf_counter()-began,5)
                self.assertEqual(len(samples),241)
                self.assertFalse(server.position_geometry_quality(samples)[1])
        finally:
            release.set()

    def test_geometry_completeness_checks_gaps_endpoints_and_finite_coordinates(self):
        full = [{'ElapsedSeconds':i/4,'X':i,'Y':i} for i in range(401)]
        self.assertEqual(server.position_geometry_quality(full), (1, True))
        for missing in [range(100,260), range(100,105), range(0,4), range(397,401)]:
            damaged = [{**p, **({'X':None} if i in missing else {})} for i,p in enumerate(full)]
            coverage, complete = server.position_geometry_quality(damaged)
            self.assertGreater(coverage,.55)
            self.assertFalse(complete)
        invalid = [{**p,'X':float('nan')} for p in full]
        self.assertEqual(server.position_geometry_quality(invalid),(0,False))

    def test_position_join_matches_dataframe_nearest_with_gaps_and_ties(self):
        start = datetime(2026, 9, 12, 14, 10, tzinfo=timezone.utc)
        def point(t, **values):
            return {'date': (start + timedelta(seconds=t)).isoformat(), **values}
        car = [point(t, speed=200) for t in [0, .2, .4, .6, 1, 1.7, 2.8]]
        location = [point(t, x=i, y=-i) for i, t in enumerate([0, .4, .4, .8, 2])]
        actual = server.join_openf1_positions(car, location)
        left, right = pd.DataFrame(car), pd.DataFrame(location)
        left['_date'] = pd.to_datetime(left.date, format='mixed')
        right['_date'] = pd.to_datetime(right.date, format='mixed')
        expected = pd.merge_asof(left, right[['_date','x','y']], on='_date',
                                 direction='nearest', tolerance=pd.Timedelta(milliseconds=400))
        self.assertEqual([(server.seconds(p.get('x')), server.seconds(p.get('y'))) for p in actual],
                         [(server.seconds(p.x), server.seconds(p.y)) for p in expected.itertuples()])

    def test_selected_context_needs_only_two_parallel_streams(self):
        start = datetime(2026, 9, 12, 14, 10, tzinfo=timezone.utc)
        calls = []
        def upstream(endpoint, **params):
            calls.append(endpoint)
            return [{"date": (start + timedelta(seconds=i/4)).isoformat(),
                     "speed": 200, "throttle": 100, "brake": 0, "n_gear": 6,
                     "rpm": 10000, "drs": 0, "x": i*10, "y": i}
                    for i in range(-4, 245)]
        with patch.object(server, 'openf1', side_effect=upstream), \
             patch.object(server, 'load_session', side_effect=AssertionError('whole session loaded')), \
             patch.object(server, 'read_prepared_cache', side_effect=AssertionError('cache read')), \
             patch.object(server, 'write_prepared_cache', side_effect=AssertionError('cache write')):
            response = Response()
            payload = server.telemetry(response, year=2026, gp='Spanish Grand Prix', session='Q',
                driver='VER', driver_number='3', session_key=11365, lap=17, round=None,
                lap_start=start, lap_time=60, fresh=True, geometry=False, next_start=None)
        self.assertCountEqual(calls, ['car_data','location'])
        self.assertEqual(response.headers['cache-control'], 'no-store')
        samples = payload['samples']
        self.assertEqual(len(samples), 241)
        self.assertEqual(samples[0]['ElapsedSeconds'], 0)
        self.assertEqual(samples[-1]['ElapsedSeconds'], 60)

    def test_weather_results_match_original_without_repeated_dataframe_scans(self):
        source = subprocess.check_output(['git','show','c7a201800752fffbe6e48d14335a53872eb7af50:server.py'], text=True)
        tree = ast.parse(source)
        original = next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='nearest_weather_conditions')
        namespace = dict(server.__dict__)
        exec(compile(ast.Module(body=[original], type_ignores=[]), '<original>', 'exec'), namespace)
        old = namespace['nearest_weather_conditions']
        weather = pd.DataFrame([{'Time':pd.Timedelta(seconds=i*60), 'AirTemp':20+i/20,
                                 'TrackTemp':30+i/10, 'WindSpeed':2, 'WindDirection':90,
                                 'Rainfall':False} for i in range(120)])
        targets = [i*13.7 for i in range(400)]
        started=time.perf_counter()
        expected=[old(weather,t) for t in targets]
        old_time=time.perf_counter()-started
        started=time.perf_counter()
        lookup=server.prepare_weather_lookup(weather)
        actual=[server.nearest_weather_conditions(lookup,t) for t in targets]
        new_time=time.perf_counter()-started
        self.assertEqual(actual, expected)
        print(f'Weather processing, 400 laps: {old_time:.3f}s -> {new_time:.3f}s ({old_time/new_time:.1f}x)')


if __name__ == '__main__':
    unittest.main()
