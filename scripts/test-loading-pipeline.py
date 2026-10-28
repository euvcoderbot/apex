"""Check the cold-load guards: archive breaker, venue corner cache, OpenF1 pacing."""

from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
import gzip
import json
from unittest.mock import patch
import os
import sys
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class ArchiveBreakerTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.cache = patch.object(server, "PREPARED_CACHE", Path(self.directory.name))
        self.cache.start()
        server._archive_failures.clear()

    def tearDown(self):
        server._archive_failures.clear()
        self.cache.stop()
        self.directory.cleanup()

    def test_repeated_failures_skip_that_season_until_a_success(self):
        with patch.dict(os.environ, {"APEX_F1_ARCHIVE": "on"}):
            def fail():
                raise RuntimeError("HTTP 401")
            for gp in ("A", "B", "C"):
                with self.assertRaises(RuntimeError):
                    server.archive_guard(2025, gp, "Q", fail)
            self.assertTrue(server.archive_breaker_open(2025))
            called = []
            with self.assertRaises(RuntimeError):
                server.archive_guard(2025, "D", "Q", lambda: called.append(1))
            self.assertEqual(called, [], "an open breaker must not touch the archive")
            server._archive_failures.clear()
            self.assertTrue(server.archive_breaker_open(2025), "a restart keeps the open breaker for a day")
            # Another season still loads: the archive refuses seasons, not everything.
            self.assertFalse(server.archive_breaker_open(2022))
            self.assertTrue(server.archive_usable(2022, "D", "Q"))
            server.record_archive_result(2025, True)
            self.assertTrue(server.archive_usable(2025, "D", "Q"))


class VenueCornerTests(unittest.TestCase):
    def test_corners_are_kept_on_disk_and_misses_remembered(self):
        corners = [{"number": "1", "letter": "", "x": 0, "y": 0, "angle": 0, "distance": 10.0, "fraction": None}]
        with TemporaryDirectory() as directory, \
             patch.object(server, "PREPARED_CACHE", Path(directory)):
            with patch.object(server, "_load_fallback_circuit_corners", return_value=corners) as load:
                self.assertEqual(server.get_fallback_circuit_corners.__wrapped__(2026, "Venue GP", "Qualifying", "Venue"), corners)
                self.assertEqual(server.get_fallback_circuit_corners.__wrapped__(2026, "Venue GP", "Qualifying", "Venue"), corners)
                self.assertEqual(server.get_fallback_circuit_corners.__wrapped__(2026, "Venue GP", "Race", "Venue"), corners)
                self.assertEqual(load.call_count, 1, "a restart or another session must not reload past seasons")
            with patch.object(server, "_load_fallback_circuit_corners", return_value=[]) as load:
                self.assertEqual(server.get_fallback_circuit_corners.__wrapped__(2026, "Other GP", "Race", "Other"), [])
                self.assertEqual(server.get_fallback_circuit_corners.__wrapped__(2026, "Other GP", "Race", "Other"), [])
                self.assertEqual(load.call_count, 1, "a miss is remembered for a day")


class OpenF1PacingTests(unittest.TestCase):
    def test_minute_cap_waits_for_the_oldest_request_to_age_out(self):
        sleeps = []
        clock = [1000.0]
        with patch.object(server, "OPENF1_PER_MINUTE", 3), \
             patch.object(server.time, "monotonic", lambda: clock[0]), \
             patch.object(server.time, "sleep", lambda s: (sleeps.append(round(s, 2)), clock.__setitem__(0, clock[0]+s))):
            server._openf1_recent.clear()
            server._openf1_next[0] = 0.
            for _ in range(4):
                with server._openf1_lock:
                    server._openf1_wait()
        server._openf1_recent.clear()
        # Burst spacing between the first three, then the minute cap.
        self.assertEqual(sleeps[:2], [server.OPENF1_MIN_INTERVAL_S]*2)
        self.assertAlmostEqual(sleeps[2], 60-2*server.OPENF1_MIN_INTERVAL_S, places=2)


class MirrorTests(unittest.TestCase):
    def test_a_lap_is_sliced_from_the_mirrored_session_stream_without_a_request(self):
        rows = [{"date": f"2026-10-11T12:00:{second:02d}.000000+00:00", "speed": second, "driver_number": 4}
                for second in (30, 10, 20, 40)]
        with TemporaryDirectory() as directory, patch.object(server, "PREPARED_CACHE", Path(directory)),              patch.object(server, "RAW_ROOT", Path(directory)/"raw"):
            server.openf1_session_stream.cache_clear()
            path = server.openf1_cache_path(server.openf1_url("car_data", session_key=11384, driver_number="4"))
            path.parent.mkdir(parents=True)
            with gzip.open(path, "wt", encoding="utf-8") as handle:
                json.dump(rows, handle)
            with patch.object(server, "openf1", side_effect=AssertionError("network")):
                start = datetime(2026, 10, 11, 12, 0, 15, tzinfo=timezone.utc)
                end = datetime(2026, 10, 11, 12, 0, 35, tzinfo=timezone.utc)
                points = server.openf1_window_points("car_data", 11384, 4, start, end)
            server.openf1_session_stream.cache_clear()
        self.assertEqual([p["speed"] for p in points], [20, 30])

    def test_settled_sessions_are_remembered_across_restarts(self):
        with TemporaryDirectory() as directory, patch.object(server, "PREPARED_CACHE", Path(directory)),              patch.object(server, "RAW_ROOT", Path(directory)/"raw"):
            server._settled_session_ends.cache_clear()
            server._openf1_session_ends.clear()
            with patch.object(server, "_openf1_fetch", return_value=[{"session_key": 9, "date_end": "2026-01-01T00:00:00+00:00"}]):
                self.assertTrue(server._openf1_session_settled(9))
            server._settled_session_ends.cache_clear()
            server._openf1_session_ends.clear()
            with patch.object(server, "_openf1_fetch", side_effect=AssertionError("network")):
                self.assertTrue(server._openf1_session_settled(9))
            server._settled_session_ends.cache_clear()


class RawArchiveTests(unittest.TestCase):
    def test_raw_data_lives_outside_the_repo_and_old_files_are_read_in_place(self):
        url = server.openf1_url("laps", session_key=7, driver_number="1")
        with TemporaryDirectory() as directory, patch.object(server, "PREPARED_CACHE", Path(directory)/"repo-cache"),              patch.object(server, "RAW_ROOT", Path(directory)/"archive"):
            new = server.openf1_cache_path(url)
            self.assertEqual(new.parent, Path(directory)/"archive", "new downloads go to the durable folder")
            legacy = Path(directory)/"repo-cache"/"openf1"/new.name
            legacy.parent.mkdir(parents=True)
            legacy.write_bytes(gzip.compress(b"[]"))
            self.assertEqual(server.openf1_cache_path(url), legacy, "an old in-repo file is found, not re-downloaded")
            self.assertFalse(new.exists(), "and it is not copied")
            new.parent.mkdir(parents=True)
            new.write_bytes(gzip.compress(b"[1]"))
            self.assertEqual(server.openf1_cache_path(url), new, "the durable copy wins once present")

    def test_the_default_location_is_in_the_user_home_not_the_checkout(self):
        self.assertNotIn(str(server.ROOT), str(server.RAW_ROOT))


if __name__ == "__main__":
    unittest.main()
