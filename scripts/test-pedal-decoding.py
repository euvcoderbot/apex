"""Pedal decoding: the feed's 104 placeholder is missing on each pedal, and measurements never treat it as braking."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

from telemetry_sources import observed_brake, observed_throttle, fuse_native_samples  # noqa: E402
import performance  # noqa: E402
import performance_tracks  # noqa: E402


class PedalDecoding(unittest.TestCase):
    def test_placeholder_is_missing_on_each_pedal(self):
        self.assertIsNone(observed_brake(104))
        self.assertIsNone(observed_throttle(104))
        self.assertEqual(observed_brake(100), 100)
        self.assertEqual(observed_brake(0), 0)
        self.assertEqual(observed_throttle(102), 100.0)
        self.assertEqual(observed_throttle(55), 55.0)
        # Independent: a real reading on one pedal survives a placeholder on the other.
        self.assertEqual(observed_brake(100, 104), 100)
        # A brake kept only as True beside a 104 throttle is the placeholder; False is still a reading.
        self.assertIsNone(observed_brake(True, 104))
        self.assertEqual(observed_brake(False, 104), 0)
        self.assertEqual(observed_brake(True, 30), 100)

    def test_race_braking_zones_do_not_grow_into_a_placeholder(self):
        # 10 Hz samples: real braking 1.0-1.6 s, then a 104 stretch that the old bool(Brake) counted as more braking.
        rows = []
        for i in range(40):
            t = i * .1
            brake = 100 if 10 <= i <= 16 else 104 if 18 <= i <= 24 else 0
            throttle = 0 if 10 <= i <= 16 else 104 if 18 <= i <= 24 else 100
            speed = 300 - max(0, min(i, 16) - 9) * 25
            rows.append({'ElapsedSeconds': t, 'Distance': i * 8.0, 'Speed': float(speed), 'Throttle': throttle, 'Brake': brake})
        zones = performance.telemetry_metrics(rows, [])['braking']
        self.assertEqual(len(zones), 1, zones)
        self.assertLess(zones[0]['duration'], .75, zones)   # 1.0 s to the release at 1.7 s, not on through the placeholder
        # A zone whose end falls inside the placeholder has no known release: it is not measured at all.
        for row in rows[17:18]:
            row['Brake'], row['Throttle'] = 104, 104
        self.assertEqual(performance.telemetry_metrics(rows, [])['braking'], [])

    def test_qualifying_lap_keeps_its_measurements_and_marks_the_placeholder_as_a_gap(self):
        samples = []
        for i in range(400):
            samples.append({'Distance': i * 14.0, 'ElapsedSeconds': i * .24, 'Speed': 200.0, 'Throttle': 100 if not 150 <= i < 156 else 104,
                            'Brake': 0 if not 150 <= i < 156 else 104, 'X': float(i), 'Y': 0.0, 'DRS': 0})
        prepared = performance_tracks.prepare(samples, {'time': 399 * .24}, require_gps=False)
        self.assertEqual(prepared['missing_pedal_samples'], 12)
        intervals = performance_tracks.source_intervals(prepared)
        self.assertTrue((intervals[149:156] > 1.5).all())
        self.assertTrue((intervals[:148] <= .6).all())
        # The placeholder is not read as braking.
        self.assertEqual(float(prepared['a'][152, 4]), 0.0)

    def test_fusion_treats_a_placeholder_as_a_hole(self):
        from telemetry_sources import _missing
        self.assertTrue(_missing('Brake', 104))
        self.assertTrue(_missing('Throttle', 104))
        self.assertFalse(_missing('Brake', 0))
        self.assertFalse(_missing('Speed', 104))

if __name__ == '__main__':
    unittest.main()
