"""Check the telemetry-session boundary without downloading a race weekend."""

from pathlib import Path
from unittest.mock import patch
import sys
import unittest

from fastapi import HTTPException, Response

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class SessionYearBoundaryTests(unittest.TestCase):
    def test_2017_rejected_before_any_backend_request(self):
        with patch.object(server, "load_session", side_effect=AssertionError("backend called")):
            with self.assertRaises(HTTPException) as raised:
                server.session_data(Response(), year=2017, gp="Australian Grand Prix",
                                    round=1, session="Qualifying", fresh=False)
        self.assertEqual(raised.exception.status_code, 422)
        self.assertIn("2018", raised.exception.detail)

    def test_2018_reaches_telemetry_backend(self):
        with patch.object(server, "read_prepared_cache", return_value=None), \
             patch.object(server, "load_session", side_effect=RuntimeError("2018 backend reached")):
            with self.assertRaises(HTTPException) as raised:
                server.session_data(Response(), year=2018, gp="Australian Grand Prix",
                                    round=1, session="Qualifying", fresh=False)
        self.assertEqual(raised.exception.status_code, 422)
        self.assertIn("2018 backend reached", raised.exception.detail)


if __name__ == "__main__":
    unittest.main()
