"""Meeting and session lists are kept on disk and used when OpenF1 cannot answer (HTTP 401 during a live session, outages)."""
import io
import json
import sys
import tempfile
import time
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from urllib.error import HTTPError, URLError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server

MEETINGS = [{'meeting_key': 1280, 'meeting_name': 'Bahrain Grand Prix', 'country_name': 'Bahrain', 'location': 'Sakhir', 'year': 2026}]
SESSIONS = [{'session_key': 9001, 'session_name': 'Qualifying', 'meeting_key': 1280, 'date_end': '2026-10-03T09:00:00+00:00'},
            {'session_key': 9002, 'session_name': 'Race', 'meeting_key': 1280, 'date_end': '2026-10-04T16:00:00+00:00'}]
LOCKED = HTTPError('https://api.openf1.org/v1/meetings', 401, 'Unauthorized', {}, None)


class Fake:
    """OpenF1 stand-in: answers from a table, or fails the way it fails during a live session."""

    def __init__(self):
        self.calls, self.down = [], False

    def __call__(self, url):
        self.calls.append(url)
        if self.down:
            raise LOCKED
        if '/meetings' in url:
            return MEETINGS
        if '/sessions' in url:
            return SESSIONS
        return []


class OfflineMetadataTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.saved = (server.RAW_ROOT, server.PREPARED_CACHE, server._openf1_fetch)
        server.RAW_ROOT, server.PREPARED_CACHE = Path(self.tmp.name) / 'raw', Path(self.tmp.name) / 'prepared'
        self.fake = Fake()
        server._openf1_fetch = self.fake
        self.reset_memory()

    def tearDown(self):
        server.RAW_ROOT, server.PREPARED_CACHE, server._openf1_fetch = self.saved
        self.reset_memory()
        self.tmp.cleanup()

    def reset_memory(self):
        server._openf1_meta.clear()
        server._openf1_metadata_cache.clear()
        server._openf1_session_ends.clear()
        server._openf1_offline_until[0] = 0.
        server._settled_session_ends.cache_clear()

    def restart(self):
        """What a fresh server process knows: nothing in memory, only what is on disk."""
        self.reset_memory()

    def quiet(self, call, *args, **kwargs):
        with redirect_stdout(io.StringIO()) as out:
            result = call(*args, **kwargs)
        return result, out.getvalue()

    def test_lists_are_saved_when_openf1_answers(self):
        server.openf1('meetings', year=2026)
        self.assertEqual(server._saved_openf1_metadata(server.openf1_url('meetings', year=2026)), MEETINGS)

    def test_a_locked_openf1_serves_the_saved_list_after_a_restart(self):
        server.openf1('meetings', year=2026)
        server.openf1('sessions', year=2026, meeting_key=1280)
        self.restart()
        self.fake.down = True
        rows, said = self.quiet(server.openf1, 'meetings', year=2026)
        self.assertEqual(rows, MEETINGS)
        self.assertIn('using the saved meetings list', said)

    def test_a_session_is_found_by_name_with_openf1_locked(self):
        server.openf1_session(2026, 'Bahrain Grand Prix', 'Qualifying')
        self.restart()
        self.fake.down = True
        found, _ = self.quiet(server.openf1_session, 2026, 'Bahrain Grand Prix', 'Qualifying')
        self.assertEqual(found['session_key'], 9001)
        race, _ = self.quiet(server.openf1_session, 2026, 'Bahrain Grand Prix', 'Race')
        self.assertEqual(race['session_key'], 9002)

    def test_nothing_saved_still_fails_loudly(self):
        self.fake.down = True
        with self.assertRaises(HTTPError) as caught:
            server.openf1('meetings', year=2026)
        self.assertEqual(caught.exception.code, 401)

    def test_other_failures_also_fall_back(self):
        server.openf1('meetings', year=2026)
        self.restart()
        for failure in (URLError('no network'), TimeoutError('slow'), HTTPError('u', 503, 'down', {}, None)):
            server._openf1_offline_until[0] = 0.
            server._openf1_fetch = lambda url, failure=failure: (_ for _ in ()).throw(failure)
            rows, _ = self.quiet(server.openf1, 'meetings', year=2026)
            self.assertEqual(rows, MEETINGS, repr(failure))

    def test_an_empty_answer_is_never_saved(self):
        server._openf1_fetch = lambda url: []
        server.openf1('meetings', year=2030)
        self.assertIsNone(server._saved_openf1_metadata(server.openf1_url('meetings', year=2030)))

    def test_a_locked_openf1_is_not_asked_again_for_a_minute(self):
        server.openf1('meetings', year=2026)
        self.restart()
        self.fake.down = True
        self.quiet(server.openf1, 'meetings', year=2026)
        asked = len(self.fake.calls)
        for _ in range(5):
            self.quiet(server.openf1, 'meetings', year=2026)
        self.assertEqual(len(self.fake.calls), asked, 'one failed request, then the saved list for the rest of the minute')

    def test_live_wins_again_as_soon_as_openf1_answers(self):
        server.openf1('meetings', year=2026)
        self.restart()
        self.fake.down = True
        self.quiet(server.openf1, 'meetings', year=2026)
        self.fake.down = False
        server._openf1_offline_until[0] = time.monotonic() - 1
        newer = MEETINGS + [{'meeting_key': 1281, 'meeting_name': 'Next Grand Prix', 'year': 2026}]
        server._openf1_fetch = lambda url: newer
        self.assertEqual(server.openf1('meetings', year=2026), newer)
        self.assertEqual(server._saved_openf1_metadata(server.openf1_url('meetings', year=2026)), newer, 'the newer list replaces the saved one')

    def test_finished_sessions_are_recorded_as_settled(self):
        server.openf1('sessions', year=2026, meeting_key=1280)
        self.restart()
        ends = server._settled_session_ends()
        self.assertIn('9001', ends)
        self.assertIn('9002', ends)

    def test_the_raw_archive_serves_a_settled_session_with_openf1_locked(self):
        server.openf1('sessions', year=2026, meeting_key=1280)
        rows = [{'session_key': 9001, 'driver_number': 1, 'date': '2026-10-03T08:10:00+00:00', 'speed': 300}]
        self.fake.down = False
        server._openf1_fetch = lambda url: rows if 'car_data' in url else self.fake(url)
        server.openf1('car_data', session_key=9001, driver_number=1)
        self.restart()
        server._openf1_fetch = lambda url: (_ for _ in ()).throw(LOCKED)
        self.assertEqual(server.openf1('car_data', session_key=9001, driver_number=1), rows)


if __name__ == '__main__':
    unittest.main()
