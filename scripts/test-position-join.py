"""Positions joined to car packets by time interpolation between the bracketing location packets."""
import math
import os
import random
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

from telemetry_sources import interpolate_positions  # noqa: E402


def track(t):
    """A car lapping a 400 m-radius circle at a speed that varies like a lap (40-85 m/s), position in metres."""
    angle = (t * 62 + 9 * math.sin(t / 3)) / 400
    return 400 * math.cos(angle), 400 * math.sin(angle)


class PositionJoin(unittest.TestCase):
    def setUp(self):
        rng = random.Random(7)
        t, rows = 0.0, []
        while t < 90:
            rows.append((t, *track(t)))
            t += .27 + rng.uniform(-.03, .03)
        self.rows = rows
        self.car = [i * .24 + .05 for i in range(360)]

    def test_interpolation_is_closer_than_the_nearest_packet(self):
        joined = interpolate_positions(self.car, self.rows)
        stamps = [r[0] for r in self.rows]
        interp, nearest = [], []
        for t, (x, y, interval, estimated) in zip(self.car, joined):
            if x is None:
                continue
            tx, ty = track(t)
            interp.append(math.hypot(x - tx, y - ty))
            n = min(self.rows, key=lambda r: abs(r[0] - t))
            nearest.append(math.hypot(n[1] - tx, n[2] - ty))
        self.assertGreater(len(interp), 340)
        self.assertLess(sum(interp) / len(interp), .2 * sum(nearest) / len(nearest))
        self.assertTrue(all(e[3] or e[2] == 0 for e in joined if e[0] is not None))

    def test_long_gaps_and_the_edges_stay_missing(self):
        rows = [r for r in self.rows if not 30 <= r[0] <= 31.2]       # a 1.2 s hole in the location feed
        joined = interpolate_positions([30.6, -1.0, 200.0, self.rows[5][0]], rows)
        self.assertEqual(joined[0][:2], (None, None))
        self.assertEqual(joined[1][:2], (None, None))
        self.assertEqual(joined[2][:2], (None, None))
        self.assertEqual(joined[3][2:], (0.0, False))                 # an exact match is the native packet


if __name__ == '__main__':
    unittest.main()
