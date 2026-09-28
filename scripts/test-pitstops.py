"""Checks that entry-to-exit and stationary pit timing stay distinct."""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import unittest
from unittest.mock import patch

import pandas as pd
from fastapi import Response

import server
from server import fastf1_pit_visits, merge_dhl_pit_stops, openf1_pit_visits


class PitStopTests(unittest.TestCase):
    def test_openf1_distinguishes_stationary_and_lane_duration(self):
        pits = [
            {'driver_number': 4, 'lap_number': 22, 'lane_duration': 21.345,
             'pit_duration': 21.345, 'stop_duration': 2.123},
            {'driver_number': 4, 'lap_number': 49, 'pit_duration': 22.111},
            {'driver_number': 4, 'lap_number': 50, 'lane_duration': 3.0,
             'stop_duration': 2.0},
        ]
        drivers = [{'driver_number': 4, 'name_acronym': 'NOR', 'team_name': 'McLaren'}]
        visits = openf1_pit_visits(pits, drivers)
        self.assertEqual(len(visits), 2)
        self.assertEqual(visits[0]['stop_duration'], 2.123)
        self.assertEqual(visits[0]['lane_duration'], 21.345)
        self.assertIsNone(visits[1]['stop_duration'])
        self.assertEqual(visits[1]['lane_duration'], 22.111)

    def test_fastf1_pairs_the_next_out_lap_only(self):
        laps = pd.DataFrame([
            {'Driver':'NOR','DriverNumber':'4','Team':'McLaren','LapNumber':1,
             'PitInTime':pd.NaT,'PitOutTime':pd.Timedelta(seconds=10)},
            {'Driver':'NOR','DriverNumber':'4','Team':'McLaren','LapNumber':20,
             'PitInTime':pd.Timedelta(seconds=1800),'PitOutTime':pd.NaT},
            {'Driver':'NOR','DriverNumber':'4','Team':'McLaren','LapNumber':21,
             'PitInTime':pd.NaT,'PitOutTime':pd.Timedelta(seconds=1822.567)},
            {'Driver':'NOR','DriverNumber':'4','Team':'McLaren','LapNumber':35,
             'PitInTime':pd.Timedelta(seconds=3100),'PitOutTime':pd.NaT},
        ])
        visits = fastf1_pit_visits(laps)
        self.assertEqual(len(visits), 1)
        self.assertEqual(visits[0]['lap'], 20)
        self.assertEqual(visits[0]['lane_duration'], 22.567)
        self.assertIsNone(visits[0]['stop_duration'])

    def test_dhl_stationary_times_match_driver_and_lap_only(self):
        drivers = [{'driver_number': 63, 'last_name': 'Russell'}]
        visits = [{'driver_number': '63', 'lap': 31, 'lane_duration': 20.8,
                   'stop_duration': None},
                  {'driver_number': '63', 'lap': 32, 'lane_duration': 21.0,
                   'stop_duration': None}]
        stops = [{'last_name': 'Russell', 'lap': 31, 'stop_duration': 2.33},
                 {'last_name': 'Russell', 'lap': 40, 'stop_duration': 3.0}]
        self.assertEqual(merge_dhl_pit_stops(visits, drivers, stops), 1)
        self.assertEqual(visits[0]['stop_duration'], 2.33)
        self.assertIsNone(visits[1]['stop_duration'])

    def test_dhl_table_parses_every_published_stop(self):
        sample = '<table><tr><th>Driver</th></tr><tr><td>1</td><td>Mercedes</td>' \
                 '<td><strong>Russell</strong></td><td>2.33</td><td>31</td><td>25</td></tr></table>'
        parser = server._DhlPitTable()
        parser.feed(sample)
        self.assertEqual(parser.rows, [['1', 'Mercedes', 'Russell', '2.33', '31', '25']])

    def test_recent_endpoint_does_not_reload_fastf1(self):
        def feed(endpoint, **kwargs):
            return ([{'driver_number': 4, 'lap_number': 22, 'lane_duration': 21.345,
                      'stop_duration': 2.123}] if endpoint == 'pit' else
                    [{'driver_number': 4, 'name_acronym': 'NOR', 'team_name': 'McLaren'}])
        with patch.object(server, 'openf1_session', return_value={'session_key': 123}), \
             patch.object(server, 'openf1', side_effect=feed), \
             patch.object(server, 'load_fresh_session', side_effect=AssertionError('FastF1 loaded')):
            response = Response()
            result = server.car_performance_pits(response, year=2025, gp='Test Grand Prix')
        self.assertEqual(result['source'], 'OpenF1')
        self.assertEqual(result['visits'][0]['stop_duration'], 2.123)
        self.assertIn('max-age=', response.headers['Cache-Control'])
        self.assertNotIn('no-store', response.headers['Cache-Control'])


if __name__ == '__main__':
    unittest.main()
