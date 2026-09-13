"""Offline retrieval-shape and processing regression checks; no data cache involved."""
import ast
from datetime import datetime, timedelta, timezone
from pathlib import Path
import subprocess
import sys
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pandas as pd
import server
from fastapi import Response


class RetrievalTests(unittest.TestCase):
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
