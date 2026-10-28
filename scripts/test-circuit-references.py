"""FIA circuit-map parsing (fetch-fia-circuit-maps.py) and the audit's FIA check."""
import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

ROOT = Path(__file__).resolve().parents[1]


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/file)
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {'pypdf': type(sys)('pypdf')}):
        spec.loader.exec_module(module)
    return module


maps = load('fia_maps', 'fetch-fia-circuit-maps.py')
audit = load('segment_audit', 'audit-circuit-segments.py')

CANADA_2026 = """CIRCUIT DATA
SECTOR 3
SECTOR 2
SECTOR 1
-  1.873km
-  1.396km
-  1.092km
 SPEED TRAP  [T]
 INTERMEDIATE 2  [S2]
-  250m before T13
-  190m before T10
-  150m before T6 INTERMEDIATE 1  [S1]
CIRCUIT CENTRELINE LENGTH -  4.361km"""


class FiaMapTests(unittest.TestCase):
    def test_circuit_data_from_a_2026_map(self):
        data = maps.parse(CANADA_2026)
        self.assertEqual(data['centreline_m'], 4361)
        self.assertEqual(data['sectors_m'], [1092, 1396, 1873])
        self.assertEqual(data['speed_trap'], {'turn': '13', 'offset_m': -250})

    def test_activation_points_in_both_wordings(self):
        self.assertEqual(maps.point(maps.POINT.search('100m after T14')), {'turn': '14', 'offset_m': 100})
        self.assertEqual(maps.point(maps.POINT.search('40m before T3')), {'turn': '3', 'offset_m': -40})
        self.assertEqual(maps.point(maps.POINT.search('Exit T18')), {'turn': '18', 'offset_m': 0, 'at': 'exit'})

    def test_2025_maps_keep_only_the_length(self):
        data = maps.parse('(310m before Turn 1)\nCircuit Centreline Length = 4.381km')
        self.assertEqual(data['centreline_m'], 4381)
        self.assertEqual(data['zones'], [])
        self.assertNotIn('speed_trap', data)


class FiaCheckTests(unittest.TestCase):
    def test_official_straight_and_speed_trap_are_scored_on_our_centreline(self):
        grid = np.arange(0., 1000., 5.)
        cls = np.array(['straight']*len(grid), dtype=object)
        cls[100:120] = 'braking'   # 500-600 m, before the T2 apex at 650 m
        cls[120:140] = 'apex'
        official = [{'turn': '1', 'marker': 20, 'lo': 15, 'hi': 25}, {'turn': '2', 'marker': 130, 'lo': 120, 'hi': 140}]
        reference = {'event': 'Test GP', 'source': 'test', 'centreline_m': 1000,
                     'zones': [{'turn': '1', 'offset_m': 50}], 'speed_trap': {'turn': '2', 'offset_m': -200}}
        check = audit.validate(reference, grid, cls, official, [], float(grid[-1]))
        self.assertAlmostEqual(check['length_error_pct'], -.5, places=2)
        zone = check['zones'][0]
        self.assertAlmostEqual(zone['from_m'], 149.75, places=1)
        self.assertGreater(zone['straight_share'], .99, 'activation to 150 m before T2 is all straight')
        self.assertEqual(check['speed_trap']['class'], 'straight')

    def test_band_thresholds_are_compared_with_f1_insights(self):
        events = [{'turn': '1', 'apex_kmh': 122.}, {'turn': '2', 'apex_kmh': 190.}, {'turn': '3', 'apex_kmh': 90.}]
        check = audit.validate({'event': 'x', 'source': 'x'}, np.arange(0., 100., 5.),
                               np.array(['straight']*20, dtype=object), [{'turn': '1', 'marker': 2, 'lo': 1, 'hi': 3}], events, 100.)
        self.assertEqual([c['turn'] for c in check['band_changes_aws']], ['1', '2'])


if __name__ == '__main__':
    unittest.main()
