"""The raw archive stays current: only newly finished sessions are fetched, once."""
import importlib.util
import json
import sys
import unittest
import urllib.error
from argparse import Namespace
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server

spec = importlib.util.spec_from_file_location('mirror', ROOT/'scripts'/'mirror-openf1.py')
mirror = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mirror)

ARGS = Namespace(year=2026, gp=None, workers=1, dry_run=False, include_recent=False, refresh=False)
WANTED = {'Qualifying', 'Race'}


def session(key, name='Race', ended='2026-10-11T14:00:00+00:00', cancelled=False):
    return {'session_key': key, 'session_name': name, 'date_end': ended, 'location': 'Marina Bay', 'is_cancelled': cancelled}


class Source:
    """A fake OpenF1: which sessions exist, and what each stream answers."""
    def __init__(self, sessions):
        self.sessions, self.calls, self.empty, self.broken = sessions, [], set(), set()

    def openf1(self, endpoint, **params):
        self.calls.append((endpoint, params.get('session_key'), params.get('driver_number')))
        if endpoint == 'sessions':
            return self.sessions
        if endpoint == 'drivers':
            return [{'driver_number': 1}, {'driver_number': 30}]
        key = (endpoint, params['driver_number'])
        if key in self.empty:
            raise urllib.error.HTTPError('x', 404, 'Not Found', {}, None)
        if key in self.broken:
            raise urllib.error.URLError('connection reset')
        return [{'speed': 1}]

    def streams(self):
        return [c for c in self.calls if c[0] in mirror.STREAMS]


class WatchTests(unittest.TestCase):
    def run_pass(self, source, directory):
        with patch.object(server, 'RAW_ROOT', Path(directory)), patch.object(server, 'openf1', source.openf1), \
             patch.object(mirror.server, 'openf1', source.openf1):
            return mirror.run_once(ARGS, WANTED)

    def test_a_finished_session_is_fetched_once_and_later_passes_cost_one_request(self):
        with TemporaryDirectory() as directory:
            source = Source([session(1)])
            self.assertEqual(self.run_pass(source, directory), 0)
            self.assertEqual(len(source.streams()), 6)        # 2 drivers x 3 streams
            source.calls.clear()
            self.run_pass(source, directory)
            self.assertEqual(source.calls, [('sessions', None, None)], 'nothing new: only the session list is read')
            # A session that finishes later is the only thing fetched.
            source.sessions.append(session(2, 'Qualifying'))
            source.calls.clear()
            self.run_pass(source, directory)
            self.assertTrue(all(c[1] == 2 for c in source.streams()) and source.streams())

    def test_no_data_at_the_source_is_recorded_and_not_retried(self):
        with TemporaryDirectory() as directory:
            source = Source([session(1)])
            source.empty = {('laps', '30')}
            self.assertEqual(self.run_pass(source, directory), 0, 'an empty stream is an answer, not a failure')
            state = json.loads((Path(directory)/mirror.STATE_NAME).read_text())
            self.assertEqual(state['sessions']['1']['empty'], ['laps:30'])
            source.calls.clear()
            self.run_pass(source, directory)
            self.assertEqual(source.streams(), [])

    def test_a_real_failure_leaves_the_session_for_the_next_pass(self):
        with TemporaryDirectory() as directory:
            source = Source([session(1)])
            source.broken = {('car_data', '1')}
            self.assertEqual(self.run_pass(source, directory), 1)
            self.assertNotIn('1', json.loads((Path(directory)/mirror.STATE_NAME).read_text())['sessions'])
            source.broken = set()
            source.calls.clear()
            self.assertEqual(self.run_pass(source, directory), 0)
            self.assertTrue(source.streams(), 'the failed session is tried again')

    def test_cancelled_and_unsettled_sessions_are_left_alone(self):
        with TemporaryDirectory() as directory:
            source = Source([session(1, cancelled=True), session(2, ended='2999-01-01T00:00:00+00:00')])
            self.run_pass(source, directory)
            self.assertEqual(source.streams(), [])


class WatchLockTests(unittest.TestCase):
    def test_only_one_watcher_runs_and_a_dead_one_does_not_block(self):
        with TemporaryDirectory() as directory, patch.object(server, 'RAW_ROOT', Path(directory)):
            lock = Path(directory)/mirror.LOCK_NAME
            self.assertIsNone(mirror.acquire_watch_lock(), 'the first watcher takes the lock')
            self.assertEqual(lock.read_text(), str(__import__('os').getpid()))
            # Another live process holds it: this one steps aside.
            holder = __import__('subprocess').Popen([sys.executable, '-c', 'import time; time.sleep(30)'])
            try:
                lock.write_text(str(holder.pid))
                self.assertEqual(mirror.acquire_watch_lock(), holder.pid)
            finally:
                holder.kill(); holder.wait()
            # Its PID is gone (a crash, a restart): the lock is stale and is taken over.
            lock.write_text(str(holder.pid))
            self.assertIsNone(mirror.acquire_watch_lock())
            self.assertEqual(lock.read_text(), str(__import__('os').getpid()))


class ScheduleTests(unittest.TestCase):
    """The watcher sleeps until the published schedule says a session has settled."""
    NOW = datetime(2026, 11, 7, 12, 0, tzinfo=timezone.utc)

    def wake(self, sessions, archived=()):
        source = Source(sessions)
        with TemporaryDirectory() as directory, patch.object(server, 'RAW_ROOT', Path(directory)),              patch.object(server, 'openf1', source.openf1), patch.object(mirror.server, 'openf1', source.openf1):
            for key in archived:
                state = mirror.load_state()
                state['sessions'][str(key)] = {}
                mirror.save_state(state)
            return mirror.next_wake(ARGS, WANTED, now=self.NOW)

    def test_sleeps_until_six_hours_after_the_session_ends(self):
        # Qualifying ends 15:00 today; settles 21:00, 9 hours from now.
        seconds, why = self.wake([session(5, 'Qualifying', ended='2026-11-07T15:00:00+00:00')])
        self.assertAlmostEqual(seconds, 9*3600+120, delta=1)
        self.assertIn('Marina Bay Qualifying settles', why)

    def test_picks_the_nearest_of_several_sessions(self):
        seconds, _ = self.wake([session(5, 'Race', ended='2026-11-08T16:00:00+00:00'),
                                session(4, 'Qualifying', ended='2026-11-07T15:00:00+00:00')])
        self.assertAlmostEqual(seconds, 9*3600+120, delta=1)

    def test_a_far_off_race_only_wakes_to_reread_the_schedule(self):
        seconds, why = self.wake([session(5, 'Race', ended='2026-11-29T16:00:00+00:00')])
        self.assertEqual(seconds, mirror.SCHEDULE_CHECK_HOURS*3600)
        self.assertIn('re-reading the schedule', why)

    def test_a_session_past_its_settle_time_but_not_archived_is_retried_soon(self):
        seconds, why = self.wake([session(5, 'Race', ended='2026-11-06T10:00:00+00:00')])
        self.assertEqual(seconds, mirror.RETRY_MINUTES*60)
        self.assertIn('not archived yet', why)

    def test_archived_cancelled_and_abandoned_sessions_are_not_waited_for(self):
        seconds, why = self.wake([session(5, 'Race', ended='2026-11-06T10:00:00+00:00'),
                                  session(6, 'Qualifying', ended='2026-11-07T15:00:00+00:00', cancelled=True),
                                  session(7, 'Race', ended='2026-10-01T10:00:00+00:00')], archived=[5])
        self.assertEqual(seconds, mirror.SCHEDULE_CHECK_HOURS*3600)
        self.assertIn('no unarchived sessions', why)


if __name__ == '__main__':
    unittest.main()
