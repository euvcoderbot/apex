"""Regression checks for observational validity, not expected team reputations."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import unittest
from performance import tyre_condition_evidence, compute_development_progression
from performance_tracks import prepare, measure_field, common_zone_scores
from server import openf1_pit_visits


class AuditFixTests(unittest.TestCase):
    def samples(self):
        return [dict(Distance=i*50, ElapsedSeconds=i*.8, Speed=250,
                     Throttle=100, Brake=False, X=None, Y=None, DRS=12) for i in range(101)]

    def test_native_spike_is_not_repaired_or_scored(self):
        samples = self.samples()
        samples[50]['Speed'] = 999
        with self.assertRaises(ValueError):
            prepare(samples, {'time':80}, require_gps=False)
        samples[50]['Speed'] = 280
        with self.assertRaisesRegex(ValueError, 'spike'):
            prepare(samples, {'time':80}, require_gps=False)

    def test_native_speed_evidence_survives_missing_gps(self):
        selection = {'team':'A:0', 'team_name':'A', 'driver':'AAA', 'lap':3, 'time':80}
        result = measure_field([('A:0', self.samples(), None)], [selection])
        self.assertEqual(result['teams'], {})
        self.assertEqual(result['native_speed_observations']['A']['top_speed'], 250)

    def test_missing_crossing_is_not_inferred(self):
        complete = {'one':{'A':1.,'B':2.,'C':2.}, 'two':{'A':4.,'B':3.,'C':3.}}
        scores, counts, keys = common_zone_scores(complete)
        self.assertTrue(all(v == 0 for v in scores.values()))
        del complete['two']['A']
        scores, counts, keys = common_zone_scores(complete)
        self.assertEqual(keys, ['one'])
        self.assertEqual(counts, dict.fromkeys('ABC', 1))
        self.assertEqual(scores['B'], 1.)

    def tyre_rows(self, rate):
        return [dict(driver=d, lap=i+10, age=i+4, time=95+rate*i,
                     stint=1, compound='MEDIUM', rain=False, accurate=True,
                     pit=False, deleted=False, track='1') for d in 'ABC' for i in range(6)]

    def test_smooth_drying_is_not_degradation_evidence(self):
        rows = self.tyre_rows(-.7)
        evidence = tyre_condition_evidence(rows[:6], rows)
        self.assertFalse(evidence['stable_condition_screen'])
        self.assertIn('field-wide-rapid-improvement', evidence['condition_flags'])
        self.assertEqual(evidence['field_trend_drivers'], 3)

    def test_small_negative_tyre_trend_is_not_clipped(self):
        rows = self.tyre_rows(-.01)
        self.assertTrue(tyre_condition_evidence(rows[:6], rows)['stable_condition_screen'])

    def test_development_is_order_independent_and_rejects_collinearity(self):
        rows = [dict(round=i, deficit=.5-.01*i, median_apex=100+i*3,
                     straight_share=.2+i*.03) for i in range(1, 11)]
        forward = compute_development_progression(rows)
        self.assertEqual(forward, compute_development_progression(rows[::-1]))
        self.assertFalse(forward['circuit_adjustment_supported'])

    def test_untimed_visit_is_unknown_not_a_zero_second_stop(self):
        pits = [{'driver_number':1,'lap_number':20,'lane_duration':22}]
        result = openf1_pit_visits(pits, [])
        self.assertEqual(result[0]['visit_type'], 'unknown')
        self.assertIsNone(result[0]['stop_duration'])


if __name__ == '__main__':
    unittest.main()
