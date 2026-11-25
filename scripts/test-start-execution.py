import math
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from start_execution import standing_start
from start_archive import capture_start, read_reports


class LaunchTests(unittest.TestCase):
    def setUp(self):
        self.parked = [(t/4, 0., False) for t in range(-8, 1)]
        self.run = [(i*.24, 3.6*5*i*.24, False) for i in range(1, 33)]

    def test_constant_acceleration_at_irregular_intervals(self):
        result = standing_start(self.parked+self.run[:4]+self.run[5:])
        for d, mark in result.items():
            self.assertAlmostEqual(mark['seconds'], math.sqrt(2*d/5), delta=.24)
            self.assertAlmostEqual(mark['kmh'], math.sqrt(2*5*d)*3.6, delta=1)
        self.assertIn(100, result)

    def test_stationary_or_rolling_cannot_be_grid_launch(self):
        for rows in ([], self.parked, self.run, [(1,20,False)]+self.parked+self.run):
            self.assertEqual(standing_start(rows), {})

    def test_brake_gap_or_repeated_clock_terminates_trace(self):
        for tail in ([(2.4,43,True)], [(2.9,80,False)], [self.run[8]]):
            result = standing_start(self.parked+self.run[:9]+tail+self.run[10:])
            self.assertNotIn(20, result)

    def test_valid_slow_start_is_retained(self):
        self.assertIn(10, standing_start(self.parked+[(i*.2,i*.2*3.6,False) for i in range(1,51)]))

    def test_a_stopped_gap_requires_a_new_parked_baseline(self):
        first = [(-4, 0., False), (-3.7, 0., False)]
        self.assertEqual(standing_start(first+self.parked+self.run), standing_start(self.parked+self.run))
        self.assertEqual(standing_start(first+self.parked[-3:]+self.run), {})
        self.assertEqual(standing_start(self.parked+self.run[2:]), {})

    def test_long_run_has_more_checkpoints_only_before_braking(self):
        straight = [(i*.25, min(300., 18*i*.25), False) for i in range(1, 73)]
        full = standing_start(self.parked+straight)
        self.assertIn(700, full)
        braking = standing_start(self.parked+straight[:34]+[(8.75, 150., True)]+straight[35:])
        self.assertIn(150, braking)
        self.assertNotIn(200, braking)

    def test_session_capture_retries_and_merges_race_and_sprint(self):
        start = datetime(2026, 11, 29, 16, tzinfo=timezone.utc)
        def fetch(endpoint, session_key, **filters):
            rows = {
                'race_control': [dict(message='SESSION STARTED', category='SessionStatus', lap_number=0, date=start.isoformat()),
                                 dict(message='SESSION FINISHED')],
                'drivers': [dict(driver_number=63, name_acronym='RUS', team_name='Mercedes')],
                'starting_grid': [dict(position=1, driver_number=63)],
                'car_data': [dict(date=(start+timedelta(seconds=t)).isoformat(), driver_number=63, speed=speed, brake=brake)
                             for t,speed,brake in self.parked+self.run],
            }
            return [dict(row, session_key=session_key) for row in rows[endpoint]]
        with TemporaryDirectory() as directory:
            root = Path(directory)
            event = {'name':'Test Grand Prix', 'round':23}
            race = {'year':2026, 'session_name':'Race', 'session_key':1}
            sprint = {**race, 'session_name':'Sprint', 'session_key':2}
            path = root/'starts/2026.json'
            self.assertTrue(capture_start(race, event, root, fetch))
            def missing(endpoint, **filters):
                return [] if endpoint == 'car_data' else fetch(endpoint, **filters)
            with self.assertRaisesRegex(ValueError, 'No launch window'):
                capture_start(sprint, event, root, missing)
            self.assertEqual(len(read_reports(path)), 1)
            self.assertTrue(capture_start(sprint, event, root, fetch))
            self.assertFalse(capture_start(sprint, event, root, fetch))
            self.assertEqual({row['session'] for row in read_reports(path)}, {'Race', 'Sprint'})


if __name__ == '__main__':
    unittest.main()
