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
    with patch.dict(sys.modules, {'pdfplumber': type(sys)('pdfplumber')}):
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


def phrase(x, text, top):
    """A phrase as pdfplumber returns it: one word each, 4 points a character, 2 points apart."""
    out = []
    for word in text.split():
        out.append({'x0': x, 'x1': x + 4*len(word), 'top': top, 'text': word})
        x += 4*len(word) + 2
    return out


def ending(x1, text, top):
    """A right-aligned phrase (the normal-grip column) ending at x1."""
    return phrase(x1 - (4*len(text.replace(' ', '')) + 2*text.count(' ')), text, top)


# The 2026 Hungarian map's table, laid out as printed: an Overtake activation wrapped onto the next line ("30m before" /
# "T14-exit"), a detection printed just above its label, a zone point naming a corner's entry, and a low-grip "n/a".
HUNGARY_2026 = (phrase(97, 'CIRCUIT DATA', 747) + phrase(273, 'OVERTAKE', 747) + phrase(430, 'STRAIGHT MODE', 747)
                + phrase(293, '- Entry T14', 758)
                + phrase(246, 'DETECTION', 759) + ending(437, '40m after T14', 759) + phrase(447, '- ZONE A1 -', 759) + phrase(498, '100m after T14', 759)
                + phrase(247, 'ACTIVATION - 30m before', 766) + ending(436, '30m after T1A-entry', 766) + phrase(446, '- ZONE A2 -', 766)
                + phrase(498, '100m after T1A-entry', 766)
                + phrase(297, 'T14-exit', 773) + ending(437, '50m after T3', 773) + phrase(447, '- ZONE A3 -', 773) + phrase(498, 'n/a', 773))


class Fia2026TableTests(unittest.TestCase):
    def test_points_as_printed(self):
        self.assertEqual(maps.read_point('45m after T14-entry'), {'text': '45m after T14-entry', 'turn': '14', 'offset_m': 45, 'at': 'entry'})
        self.assertEqual(maps.read_point('T15 Exit'), {'text': 'T15 Exit', 'turn': '15', 'offset_m': 0, 'at': 'exit'})
        self.assertEqual(maps.read_point('Exit of T17')['at'], 'exit')
        self.assertEqual(maps.read_point('Mid-T15'), {'text': 'Mid-T15', 'turn': '15', 'offset_m': 0, 'at': 'mid'})
        self.assertEqual(maps.read_point('100m after T11 / Pit Exit')['offset_m'], 100)
        self.assertEqual(maps.read_point('12m after finish line'), {'text': '12m after finish line', 'line': 'finish', 'offset_m': 12})
        self.assertEqual(maps.read_point('SC2 before Turn 2'), {'text': 'SC2 before Turn 2'}, 'loose wording is kept, not placed')
        self.assertIsNone(maps.read_point('n/a'))

    def test_overtake_and_straight_mode_columns(self):
        table = maps.table_2026(HUNGARY_2026)
        self.assertEqual(table['overtake']['detection']['text'], 'Entry T14')
        self.assertEqual(table['overtake']['activation'], {'text': '30m before T14-exit', 'turn': '14', 'offset_m': -30, 'at': 'exit'})
        zones = {z['zone']: z for z in table['straight_mode']}
        self.assertEqual(zones['A1']['normal']['offset_m'], 40)
        self.assertEqual(zones['A1']['low']['offset_m'], 100)
        self.assertEqual(zones['A2']['normal']['turn'], '1A')
        self.assertIsNone(zones['A3']['low'], 'n/a: the zone is not used in low grip')
        data = maps.parse('STRAIGHT MODE\nCIRCUIT CENTRELINE LENGTH - 4.381km', HUNGARY_2026)
        self.assertEqual(data['zone_kind'], 'straight-mode')
        self.assertEqual([z['offset_m'] for z in data['zones']], [40, 30, 50], 'the audit gets the normal-grip activation points')

    def test_drs_legend_numbers_and_wordings(self):
        drs = maps.drs_points('DRS Detection 40m After Turn 15\nDRS Activation 305m After Turn 16\n'
                              'DRS DETECTION 2\nDRS Detection 1 [250m before Turn 5] 19 S2\nDRS Activation 2 (155m before Turn 12) 3 2')
        self.assertEqual([(p['number'], p['offset_m']) for p in drs['detection']], [(None, 40), (1, -250)])
        self.assertEqual([(p['number'], p['turn']) for p in drs['activation']], [(None, '16'), (2, '12')])


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
