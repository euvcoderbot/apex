"""The upstream-outage regression: exact retained observations, current maths."""
import copy,json,sys,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi import Response
import server
from performance import analyze
from verified_sources import recorded_session,recorded_lap,performance_input,_recordings


class SourceRecoveryTests(unittest.TestCase):
    def test_exact_completed_identity_and_original_expiry_are_required(self):
        r=recorded_session(2026,'Singapore Grand Prix','Q')
        self.assertEqual(len(r['data']['drivers']),22)
        self.assertIsNone(recorded_session(2025,'Singapore Grand Prix','Q'))
        self.assertIsNone(recorded_session(2026,'Singapore','Q'))
        self.assertIsNone(recorded_session(2026,'Singapore Grand Prix','Q',now=r['expires']))

    def test_lap_recovery_never_substitutes_another_lap_or_clock(self):
        r=recorded_session(2026,'Singapore Grand Prix','Q')
        lap=recorded_lap(r,driver='VER',number='3',lap=11,start=3730.433,end=3821.806,duration=91.373)
        self.assertIsNotNone(lap)
        self.assertIsNone(recorded_lap(r,driver='VER',lap=12))
        self.assertIsNone(recorded_lap(r,driver='VER',lap=11,start=3731))
        self.assertIsNone(recorded_lap(r,driver='VER',number='16',lap=11))

    def test_current_analysis_is_recomputed_from_records_not_old_scores(self):
        r=recorded_session(2026,'Singapore Grand Prix','Q')
        before=json.dumps(r,sort_keys=True)
        result=analyze(performance_input(r),2)
        self.assertEqual(result['method'],'car-performance-v12-supported-nonlinear')
        self.assertEqual(len(result['teams']),11)
        self.assertAlmostEqual(result['teams'][0]['lap']['time'],91.373)
        self.assertEqual(json.dumps(r,sort_keys=True),before)
        self.assertTrue(any(row['fresh'] is None for row in performance_input(r).apex_recorded_rows))

    def test_upstream_failure_retains_qualifying_data_and_marks_failed_refresh(self):
        with patch.object(server,'load_fresh_session',side_effect=RuntimeError('upstream 404')):
            result=server.car_performance(Response(),2026,'Singapore Grand Prix','Q',True)
            session=server.session_data(Response(),2026,'Singapore Grand Prix',17,'Q',True)
        self.assertEqual(len(result['teams']),11)
        self.assertTrue(result['source_cache']['refresh_failed'])
        self.assertTrue(session['source_cache']['refresh_failed'])
        self.assertEqual(session['event'],'Singapore Grand Prix')

    def test_team_batch_retains_all_eleven_native_laps_during_archive_outage(self):
        r=recorded_session(2026,'Singapore Grand Prix','Q')
        by_team={}
        for item in r['telemetry']:
            s=item['selection']
            if s['team']==s.get('team_name') and s['team']!=s['driver']:by_team[s['team']]=s
        with patch.object(server,'fastf1_runtime',side_effect=AssertionError('Should not download source again')):
            result=server.car_performance_trace_batch(Response(),2026,'Singapore Grand Prix',json.dumps(list(by_team.values())))
        self.assertEqual(len(result['teams']),11)
        self.assertEqual(result['source_cache']['kind'],'verified-recording')
        self.assertEqual(result['methodology_version'],'car-measurements-v12-local-evidence')


if __name__=='__main__':unittest.main()
