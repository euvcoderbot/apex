"""Check the cold-load guards: archive breaker, venue corner cache, OpenF1 pacing."""

from pathlib import Path
from tempfile import TemporaryDirectory
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


if __name__ == "__main__":
    unittest.main()
