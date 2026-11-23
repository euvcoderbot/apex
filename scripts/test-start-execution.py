import math
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from start_execution import standing_start


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


if __name__ == '__main__':
    unittest.main()
