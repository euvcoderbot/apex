"""The upstream-outage regression: exact retained observations, current maths."""
import copy,json,sys,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi import Response
import server
from performance import analyze
from verified_sources import recorded_session,recorded_lap,recorded_payload,recorded_pits,performance_input,_recordings


class SourceRecoveryTests(unittest.TestCase):
    def test_azerbaijan_session_and_every_fastest_native_lap_survive_archive_outage(self):
        r = recorded_session(2026, 'Azerbaijan Grand Prix', 'Q')
        self.assertEqual(len(r['data']['drivers']), 22)
        self.assertEqual(sum(len(d['laps']) for d in r['data']['drivers']), 373)
        self.assertEqual(len(r['corners']), 20)
        self.assertEqual(len(r['telemetry']), 22)
        with patch.object(server, 'load_session', side_effect=AssertionError('Unavailable archive must not be used')):
            result = server.session_data(Response(), 2026, 'Azerbaijan Grand Prix', 15, 'Q', False)
        self.assertEqual(len(result['available_telemetry']), 22)
        for d in result['drivers']:
            fastest = min((l for l in d['laps'] if l['accurate'] and not l['deleted'] and not l['in_lap'] and not l['out_lap']), key=lambda l: l['time'])
            native = recorded_lap(r, driver=d['code'], number=d['number'], lap=fastest['lap'],
                                  start=fastest['lap_start_seconds'], end=fastest['lap_end_seconds'], duration=fastest['time'])
            self.assertIsNotNone(native)
            self.assertAlmostEqual(native['samples'][0]['ElapsedSeconds'], 0)
            self.assertAlmostEqual(native['samples'][-1]['ElapsedSeconds'], fastest['time'])
            self.assertTrue(native['position_complete'])

    def test_azerbaijan_native_telemetry_does_not_need_live_source_metadata(self):
        r = recorded_session(2026, 'Azerbaijan Grand Prix', 'Q')
        native = next(t for t in r['telemetry'] if t['selection']['driver'] == 'VER')
        s = native['selection']
        with patch.object(server, 'openf1', side_effect=AssertionError('No repeated native download')), \
             patch.object(server, 'read_prepared_cache', return_value=None), \
             patch.object(server, 'write_prepared_cache'):
            result = server.telemetry(Response(), year=2026, gp='Azerbaijan Grand Prix', round=15,
                session='Q', driver=s['driver'], lap=s['lap'], driver_number=s['driver_number'],
                session_key=None, fresh=False, geometry=False, lap_start=None, lap_time=s['time'],
                next_start=None, lap_start_seconds=s['start'], lap_end_seconds=s['end'], pit_out=False)
        self.assertEqual(result['lap'], 15)
        self.assertTrue(result['position_complete'])
        self.assertEqual(result['source_cache']['kind'], 'verified-recording')

    def test_retained_pit_visits_keep_exact_times_and_expiry(self):
        pits=recorded_pits(2026,'Singapore Grand Prix')
        original=_recordings()['2026:Singapore Grand Prix:R']['pits']
        self.assertEqual(len(pits['visits']),25)
        self.assertEqual(pits['visits'],original['data']['visits'])
        self.assertIsNone(recorded_pits(2026,'Singapore Grand Prix',now=original['expires']))
        self.assertTrue(recorded_pits(2026,'Singapore Grand Prix',now=original['expires'],allow_stale=True)['source_cache']['stale'])
        pits['visits'].clear()
        self.assertEqual(len(recorded_pits(2026,'Singapore Grand Prix')['visits']),25)

    def test_pit_recovery_does_not_depend_on_openf1_lookup_success(self):
        with patch.object(server,'openf1_session',side_effect=RuntimeError('lookup unavailable')),patch.object(server,'load_fresh_session',side_effect=RuntimeError('archive unavailable')):
            pits=server.car_performance_pits(Response(),2026,'Singapore Grand Prix',True)
        self.assertEqual(len(pits['visits']),25)
        self.assertTrue(pits['source_cache']['refresh_failed'])

    def test_race_inventory_only_exposes_unexpired_exact_native_laps(self):
        for gp,count in [('Singapore Grand Prix',22),('Bahrain Grand Prix',70)]:
            r=recorded_session(2026,gp,'R')
            inventory=recorded_payload(r)['available_telemetry']
            self.assertEqual(len(inventory),count)
            for item in inventory:
                native=recorded_lap(r,driver=item['driver'],lap=item['lap'])
                self.assertIsNotNone(native)
                self.assertIsNone(recorded_lap(r,driver=item['driver'],lap=item['lap'],now=native['expires']))

    def test_expired_lane_recording_still_accepts_independent_stationary_publication(self):
        record=recorded_session(2026,'Bahrain Grand Prix','R')
        original=recorded_pits(2026,'Bahrain Grand Prix',allow_stale=True)
        visit=original['visits'][0]
        driver=next(d for d in record['data']['drivers'] if d['code']==visit['driver'])
        stop={'last_name':driver['name'].split()[-1],'team':visit['team'],'lap':visit['lap'],'stop_duration':2.56}
        with patch.object(server,'openf1_session',side_effect=RuntimeError('lookup unavailable')),patch.object(server,'load_fresh_session',side_effect=RuntimeError('archive unavailable')),patch.object(server,'dhl_2026_pit_stops',return_value=[stop]):
            result=server.car_performance_pits(Response(),2026,'Bahrain Grand Prix',True)
        self.assertEqual(len(result['visits']),73)
        self.assertEqual(result['visits'][0]['stop_duration'],2.56)
        self.assertTrue(result['source_cache']['stale'])
        self.assertTrue(result['source_cache']['refresh_failed'])
        self.assertEqual(sum(v['stop_duration'] is not None for v in result['visits']),1)

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
        self.assertEqual(result['methodology_version'],'car-measurements-v16-speed-domain')


if __name__=='__main__':unittest.main()
