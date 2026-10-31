"""Offline regressions for recovery from an unavailable timing archive."""
import copy
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import Response
import server
from openf1_performance import adapt_performance, retained_bundle, session_payload


def bundle():
    return {'captured_at': '2026-09-26T00:00:00Z',
            'session': {'year': 2026, 'session_name': 'Qualifying', 'session_key': 10,
                        'meeting_key': 20, 'date_start': '2026-09-25T12:00:00Z'},
            'feeds': {
                'drivers': [{'driver_number': 1, 'name_acronym': 'VER', 'team_name': 'Red Bull Racing'}],
                'session_result': [{'driver_number': 1, 'position': 1, 'duration': [90, 89, 88]}],
                'laps': [{'driver_number': 1, 'lap_number': 2, 'date_start': '2026-09-25T12:01:00Z',
                          'lap_duration': 90, 'duration_sector_1': 30, 'duration_sector_2': 30,
                          'duration_sector_3': 30, 'is_pit_out_lap': False}],
                'stints': [{'driver_number': 1, 'stint_number': 1, 'lap_start': 1,
                            'lap_end': 3, 'compound': 'SOFT', 'tyre_age_at_start': 0}],
                'weather': [{'date': '2026-09-25T12:01:00Z', 'rainfall': 0}],
                'race_control': [{'date': '2026-09-25T12:00:00Z', 'category': 'Flag',
                                  'flag': 'GREEN', 'scope': 'Track', 'qualifying_phase': 1}],
                'pit': []}}


def row(value):
    return adapt_performance(2026, 'Azerbaijan Grand Prix', 'Q', value).apex_recorded_rows[0]


class AdapterTests(unittest.TestCase):
    def test_sprint_qualifying_recovers_when_primary_archive_has_no_laps(self):
        value = bundle()
        value['session']['session_name'] = 'Sprint Qualifying'
        for selected in ('SQ', 'Sprint Qualifying', 'Sprint Shootout'):
            with self.subTest(selected=selected), \
                 patch('verified_sources.recorded_session', return_value=None), \
                 patch.object(server, 'read_prepared_cache', return_value=None), \
                 patch.object(server, 'load_session', side_effect=ValueError('Data not loaded')), \
                 patch.object(server, 'load_openf1_performance', return_value=SimpleNamespace(
                     apex_source_bundle=value, apex_source_notice={'kind': 'openf1-timing'})) as fallback:
                result = server.session_data(Response(), 2026, 'Singapore Grand Prix', 17, selected, False)
            fallback.assert_called_once_with(2026, 'Singapore Grand Prix', 'SQ', fresh=False)
            self.assertEqual(result['session'], 'Sprint Qualifying')
            self.assertEqual(result['drivers'][0]['laps'][0]['phase'], 'Q1')
            self.assertEqual(result['openf1_session_key'], 10)

    def test_sprint_fallback_never_accepts_regular_qualifying(self):
        value = bundle()
        with self.assertRaisesRegex(ValueError, 'identity mismatch'):
            adapt_performance(2026, 'Singapore Grand Prix', 'SQ', value)
        for name in ('Sprint Qualifying', 'Sprint Shootout'):
            value['session']['session_name'] = name
            self.assertEqual(adapt_performance(2026, 'Singapore Grand Prix', 'SQ', value).name,
                             'Sprint Qualifying')
            with self.assertRaisesRegex(ValueError, 'identity mismatch'):
                adapt_performance(2026, 'Singapore Grand Prix', 'Q', value)

    def test_regular_qualifying_never_selects_sprint_qualifying(self):
        sessions = [
            {'session_name': 'Sprint Qualifying', 'session_key': 1},
            {'session_name': 'Sprint', 'session_key': 2},
            {'session_name': 'Qualifying', 'session_key': 3},
            {'session_name': 'Race', 'session_key': 4},
        ]
        with patch.object(server, '_openf1_meeting', return_value={'meeting_key': 20}), \
             patch.object(server, 'openf1_metadata', return_value=sessions):
            for name, key in [('Q', 3), ('Qualifying', 3), ('SQ', 1), ('S', 2), ('R', 4)]:
                self.assertEqual(server.openf1_session(2026, 'Canadian Grand Prix', name)['session_key'], key)
            sessions.pop(2)
            self.assertIsNone(server.openf1_session(2026, 'Canadian Grand Prix', 'Q'))

    def test_throttled_metadata_is_retried_and_only_success_is_shared(self):
        limited = HTTPError('', 429, 'limited', {'Retry-After': '3'}, None)
        with patch.dict(server._openf1_metadata_cache, {}, clear=True), \
             patch.object(server, 'openf1', side_effect=[limited, [{'meeting_key': 20}]]) as fetch, \
             patch.object(server.time, 'sleep') as sleep:
            self.assertEqual(server.openf1_metadata('meetings', year=2026), [{'meeting_key': 20}])
            self.assertEqual(server.openf1_metadata('meetings', year=2026), [{'meeting_key': 20}])
            self.assertEqual(fetch.call_count, 2)
            sleep.assert_called_once_with(3)
        with patch.object(server, 'openf1_metadata', side_effect=[limited, []]):
            with self.assertRaises(HTTPError):
                server.openf1_session(2026, 'Japanese Grand Prix', 'Q')
            self.assertIsNone(server.openf1_session(2026, 'Japanese Grand Prix', 'Q'))

    def test_source_throttle_remains_retryable_in_the_public_api(self):
        with patch('verified_sources.recorded_session', return_value=None), \
             patch('openf1_performance.retained_bundle', return_value=None), \
             patch.object(server, 'read_prepared_cache', return_value=None), \
             patch.object(server, 'load_fresh_session', side_effect=ValueError('archive unavailable')), \
             patch.object(server, 'load_openf1_performance', side_effect=HTTPError('', 429, 'limited', {}, None)):
            with self.assertRaises(server.HTTPException) as raised:
                server.car_performance(Response(), 2026, 'Japanese Grand Prix', 'Q', False)
        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(raised.exception.headers['Retry-After'], '10')

    def test_session_payload_exposes_phase_and_clock_without_reading_archive_metadata(self):
        value = bundle()
        payload = session_payload(2026, 'Azerbaijan Grand Prix', 'Q', value)
        lap = payload['drivers'][0]['laps'][0]
        self.assertEqual((lap['lap'], lap['time'], lap['phase']), (2, 90, 'Q1'))
        self.assertEqual(lap['timing_clock'], 'openf1-session-start')
        self.assertEqual((lap['lap_start_seconds'], lap['lap_end_seconds']), (60, 150))
        self.assertEqual(payload['openf1_session_key'], 10)

    def test_real_timing_and_classification_are_preserved(self):
        value = bundle()
        before = copy.deepcopy(value)
        lap = row(value)
        self.assertEqual((lap['time'], lap['sectors'], lap['phase'], lap['age']), (90, [30, 30, 30], 'Q1', 2))
        self.assertTrue(lap['accurate'])
        self.assertEqual(lap['track'], '1')
        self.assertIsNone(lap['fresh'])
        self.assertEqual(value, before)

    def test_another_session_is_rejected(self):
        value = bundle()
        value['feeds']['laps'][0]['session_key'] = 11
        with self.assertRaisesRegex(ValueError, 'another session'):
            row(value)
        value = bundle()
        value['session']['year'] = 2025
        with self.assertRaisesRegex(ValueError, 'identity mismatch'):
            row(value)

    def test_missing_flags_weather_and_sectors_are_not_invented(self):
        value = bundle()
        value['feeds']['race_control'] = []
        value['feeds']['weather'] = []
        value['feeds']['laps'][0]['duration_sector_2'] = None
        lap = row(value)
        self.assertEqual(lap['track'], '')
        self.assertIsNone(lap['rain'])
        self.assertFalse(lap['accurate'])

    def test_pits_and_deleted_laps_are_excluded(self):
        value = bundle()
        value['feeds']['pit'] = [{'driver_number': 1, 'lap_number': 2}]
        self.assertTrue(row(value)['pit'])
        self.assertFalse(row(value)['accurate'])
        value['feeds']['pit'] = []
        value['feeds']['race_control'].append({'date': '2026-09-25T12:03:00Z', 'message': 'CAR 1 LAP 2 DELETED'})
        self.assertTrue(row(value)['deleted'])
        value['feeds']['race_control'].append({'date': '2026-09-25T12:04:00Z', 'message': 'CAR 1 LAP 2 REINSTATED'})
        self.assertFalse(row(value)['deleted'])

    def test_sc_in_this_lap_is_not_a_green_signal(self):
        value = bundle()
        value['feeds']['race_control'] += [
            {'date': '2026-09-25T12:00:10Z', 'category': 'SafetyCar', 'message': 'SAFETY CAR DEPLOYED'},
            {'date': '2026-09-25T12:00:30Z', 'category': 'SafetyCar', 'message': 'SAFETY CAR IN THIS LAP'}]
        self.assertEqual(row(value)['track'], '')
        value['feeds']['race_control'].append({'date': '2026-09-25T12:00:50Z', 'category': 'Flag', 'flag': 'CLEAR', 'scope': 'Track'})
        self.assertEqual(row(value)['track'], '1')


class LoadingTests(unittest.TestCase):
    def test_loaded_session_with_unavailable_laps_enters_the_alternate_source(self):
        class MissingTiming:
            @property
            def laps(self):
                raise RuntimeError('DataNotLoadedError: Session.load')
        alternate = SimpleNamespace(apex_source_bundle=bundle(), apex_source_notice={'kind': 'openf1-timing'})
        with patch('verified_sources.recorded_session', return_value=None), \
             patch.object(server, 'read_prepared_cache', return_value=None), \
             patch.object(server, 'load_session', return_value=MissingTiming()), \
             patch.object(server, 'load_openf1_performance', return_value=alternate) as recover, \
             patch.object(server, 'get_tire_nominations', return_value=[]):
            result = server.session_data(Response(), 2026, 'Azerbaijan Grand Prix', 15, 'Q', False)
        recover.assert_called_once_with(2026, 'Azerbaijan Grand Prix', 'Q', fresh=False)
        self.assertEqual(result['drivers'][0]['laps'][0]['time'], 90)
        self.assertEqual(result['source_cache']['kind'], 'openf1-timing')

    def test_alternate_session_gets_same_venue_corners_but_never_another_track(self):
        # Abu Dhabi 2025: timing archive down, OpenF1 timing complete, but the
        # alternate source carries no circuit info, so the comparison had no
        # corner controls. Turn positions are venue metadata.
        class MissingTiming:
            @property
            def laps(self):
                raise RuntimeError('DataNotLoadedError: Session.load')
        alternate = SimpleNamespace(apex_source_bundle=bundle(), apex_source_notice={'kind': 'openf1-timing'})
        corners = [{'number': '1', 'letter': '', 'x': 1., 'y': 2., 'angle': 0., 'distance': None, 'fraction': None}]
        def run(fallback):
            with patch('verified_sources.recorded_session', return_value=None),                  patch.object(server, 'read_prepared_cache', return_value=None),                  patch.object(server, 'load_session', return_value=MissingTiming()),                  patch.object(server, 'load_openf1_performance', return_value=alternate),                  patch.object(server, 'get_fallback_circuit_corners', return_value=fallback) as lookup,                  patch.object(server, 'get_tire_nominations', return_value=[]):
                return server.session_data(Response(), 2026, 'Azerbaijan Grand Prix', 15, 'Q', False), lookup
        result, lookup = run(corners)
        self.assertEqual(result['corners'], corners)
        # Looked up by the payload's own venue, so a moved GP cannot borrow a different track.
        self.assertEqual(lookup.call_args.args[:3], (2026, 'Azerbaijan Grand Prix', 'Q'))
        self.assertEqual(lookup.call_args.args[3], str(result.get('location') or ''))
        self.assertEqual(run([])[0]['corners'], [])

    def test_session_info_property_failure_cannot_escape_the_response_builder(self):
        class MissingMetadata(SimpleNamespace):
            @property
            def session_info(self):
                raise RuntimeError('DataNotLoadedError: Session.load')
        data = MissingMetadata(laps=SimpleNamespace(empty=False, split_qualifying_sessions=lambda: []),
                               drivers=[], name='Qualifying', event={'EventName': 'Test Grand Prix', 'Location': 'Baku'},
                               weather_data=None, get_circuit_info=lambda: None)
        with patch('verified_sources.recorded_session', return_value=None), \
             patch.object(server, 'read_prepared_cache', return_value=None), \
             patch.object(server, 'load_session', return_value=data), \
             patch.object(server, 'fetch_openf1_session_drivers', return_value=[]), \
             patch.object(server, 'get_fallback_circuit_corners', return_value=[]), \
             patch.object(server, 'get_tire_nominations', return_value=[]):
            result = server.session_data(Response(), 2026, 'Test Grand Prix', 15, 'Q', False)
        self.assertEqual(result['location'], 'Baku')
        self.assertIsNone(result['circuit_key'])

    def test_retained_sources_have_original_expiry_and_exact_identity(self):
        value = retained_bundle(2026, 'Azerbaijan Grand Prix', 'Q')
        self.assertEqual(value['session']['session_key'], 11373)
        self.assertEqual(len(value['feeds']['laps']), 373)
        self.assertIsNone(retained_bundle(2026, 'Azerbaijan Grand Prix', 'Q', now=9999999999))
        self.assertIsNone(retained_bundle(2025, 'Azerbaijan Grand Prix', 'Q'))

    def test_rate_limit_retries_but_permanent_errors_do_not(self):
        limited = HTTPError('https://api.openf1.org', 429, 'limited', {'Retry-After': '3'}, None)
        with patch.object(server, 'openf1', side_effect=[limited, [{'lap_number': 1}]]) as fetch, \
             patch.object(server.time, 'sleep') as sleep:
            self.assertEqual(server.openf1_performance_feed('laps', 10), [{'lap_number': 1}])
        self.assertEqual(fetch.call_count, 2)
        sleep.assert_called_once_with(3)
        with patch.object(server, 'openf1', side_effect=HTTPError('', 404, 'missing', {}, None)) as fetch, \
             patch.object(server.time, 'sleep') as sleep:
            with self.assertRaises(HTTPError):
                server.openf1_performance_feed('laps', 10)
        fetch.assert_called_once()
        sleep.assert_not_called()

    def test_archive_failure_recovers_and_runs_current_analysis(self):
        data = SimpleNamespace(apex_source_notice={'kind': 'openf1-timing'})
        with patch('verified_sources.recorded_session', return_value=None), \
             patch('openf1_performance.retained_bundle', return_value=None), \
             patch.object(server, 'read_prepared_cache', return_value=None), \
             patch.object(server, 'load_fresh_session', side_effect=RuntimeError('401')), \
             patch.object(server, 'load_openf1_performance', return_value=data) as fallback, \
             patch('performance.analyze', return_value={'teams': []}) as analyze:
            result = server.car_performance(Response(), 2026, 'Azerbaijan Grand Prix', 'Q', False)
        fallback.assert_called_once_with(2026, 'Azerbaijan Grand Prix', 'Q', fresh=False)
        analyze.assert_called_once_with(data, 2)
        self.assertEqual(result['source_cache']['kind'], 'openf1-timing')

    def test_valid_cached_fallback_does_not_retry_broken_archive(self):
        data = SimpleNamespace(apex_source_notice={'kind': 'openf1-timing'})
        with patch('verified_sources.recorded_session', return_value=None), \
             patch.object(server, 'read_prepared_cache', return_value={'ready': True}), \
             patch.object(server, 'load_fresh_session') as archive, \
             patch.object(server, 'load_openf1_performance', return_value=data), \
             patch('performance.analyze', return_value={}):
            server.car_performance(Response(), 2026, 'Azerbaijan Grand Prix', 'R', False)
        archive.assert_not_called()

    def test_incomplete_fetch_is_never_cached(self):
        with patch.object(server, 'read_prepared_cache', return_value=None), \
             patch('openf1_performance.retained_bundle', return_value=None), \
             patch.object(server, 'openf1_session', return_value=bundle()['session']), \
             patch.object(server, 'openf1', return_value=[]), \
             patch.object(server, 'write_prepared_cache') as write:
            with self.assertRaisesRegex(ValueError, 'lacks timing'):
                server.load_openf1_performance(2026, 'Azerbaijan Grand Prix', 'Q')
        write.assert_not_called()

    def test_explicit_refresh_keeps_valid_sources_during_an_outage(self):
        with patch.object(server, 'openf1_session', return_value=None):
            data = server.load_openf1_performance(2026, 'Azerbaijan Grand Prix', 'R', fresh=True)
        self.assertEqual(len(data.apex_recorded_rows), 983)
        self.assertTrue(data.apex_source_notice['refresh_failed'])
        self.assertTrue(data.apex_source_notice['retained'])

    def test_refresh_recovers_valid_prepared_bundle_when_source_is_down(self):
        cached = bundle()
        with patch('openf1_performance.retained_bundle', return_value=None), \
             patch('openf1_performance.adapt_performance', return_value=SimpleNamespace()), \
             patch.object(server, 'read_prepared_cache', return_value=cached), \
             patch.object(server, 'openf1_session', return_value=None):
            data = server.load_openf1_performance(2026, 'Azerbaijan Grand Prix', 'Q', fresh=True)
        self.assertIs(data.apex_source_bundle, cached)
        self.assertTrue(data.apex_source_notice['refresh_failed'])
        self.assertFalse(data.apex_source_notice['retained'])


if __name__ == '__main__':
    unittest.main()
