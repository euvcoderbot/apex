"""Local practice bypasses the unavailable archive without changing native maths."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import HTTPException, Response
import local_api
import server


class LocalPracticeTests(unittest.TestCase):
    def setUp(self):
        self.identity = {'session_name': 'Practice 2', 'year': 2026, 'session_key': 11390,
                         'date_start': (datetime.now(timezone.utc)-timedelta(hours=2)).isoformat(),
                         'location': 'Austin', 'circuit_key': 9}
        self.drivers = [{'code': 'VER', 'laps': [{'lap': 2, 'time': 95.8}], 'lap_data_complete': True}]

    def test_practice_calls_shared_timing_parser_without_archive_or_export(self):
        with patch.object(server, 'openf1_session', return_value=self.identity), \
             patch.object(server, 'event_calendar', return_value=[{'name': 'United States Grand Prix', 'round': 18}]), \
             patch.object(server, 'fetch_openf1_session_drivers', return_value=self.drivers) as parse, \
             patch.object(server, 'get_tire_nominations', return_value=[]), \
             patch.object(server, 'session_data', side_effect=AssertionError('archive')):
            response = Response()
            data = local_api.session_data(response, 2026, 'United States Grand Prix', 18, 'FP2', False)
        self.assertEqual(data['session'], 'Practice 2')
        self.assertEqual(data['drivers'], self.drivers)
        self.assertEqual(data['openf1_session_key'], 11390)
        self.assertEqual(response.headers['cache-control'], 'max-age=120')
        self.assertEqual(parse.call_args.args[:3], (2026, 'United States Grand Prix', 'Practice 2'))

    def test_fresh_bypasses_summary_lru_and_partial_data_stays_flagged(self):
        def parsed(*args):
            return [{'code': 'VER', 'laps': [{'lap': 2}], 'lap_data_complete': False}]
        with patch.object(server, 'openf1_session', return_value=self.identity), \
             patch.object(server.fetch_openf1_session_drivers, '__wrapped__', parsed), \
             patch.object(server, 'get_tire_nominations', return_value=[]):
            data = local_api.practice_data(2026, 'United States Grand Prix', None, 'Practice 2', True)
        self.assertFalse(data['lap_data_complete'])

    def test_wrong_round_is_rejected_before_timing_is_loaded(self):
        with patch.object(server, 'openf1_session', return_value=self.identity), \
             patch.object(server, 'event_calendar', return_value=[{'name': 'Other Grand Prix', 'round': 18}]), \
             patch.object(server, 'fetch_openf1_session_drivers', side_effect=AssertionError('wrong event')):
            with self.assertRaises(HTTPException) as error:
                local_api.practice_data(2026, 'United States Grand Prix', 18, 'Practice 2')
        self.assertEqual(error.exception.status_code, 422)

    def test_future_and_cancelled_sessions_are_not_synthesized(self):
        for change in [{'is_cancelled': True}, {'date_start': (datetime.now(timezone.utc)+timedelta(days=1)).isoformat()}]:
            with patch.object(server, 'openf1_session', return_value={**self.identity, **change}):
                with self.assertRaises(HTTPException) as error:
                    local_api.practice_data(2026, 'United States Grand Prix', None, 'Practice 2')
                self.assertEqual(error.exception.status_code, 422)

    def test_empty_source_is_retryable_not_a_cached_success(self):
        with patch.object(server, 'openf1_session', return_value=self.identity), \
             patch.object(server, 'fetch_openf1_session_drivers', return_value=[]):
            with self.assertRaises(HTTPException) as error:
                local_api.practice_data(2026, 'United States Grand Prix', None, 'Practice 2')
        self.assertEqual(error.exception.status_code, 503)

    def test_nonpractice_and_historical_practice_keep_shared_routes(self):
        with patch.object(server, 'session_data', return_value={'shared': True}) as shared:
            for year, session in [(2026, 'Qualifying'), (2020, 'Practice 1')]:
                self.assertEqual(local_api.session_data(Response(), year, 'British Grand Prix', 10, session, False), {'shared': True})
            self.assertEqual(shared.call_count, 2)
        self.assertIs(local_api.app.routes[-1].app, server.app)


if __name__ == '__main__':
    unittest.main()
