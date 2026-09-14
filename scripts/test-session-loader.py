"""Fresh session fan-out and context isolation, without external requests."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import sys
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import session_loader as loader
from fastf1 import _api


class FreshSessionTests(unittest.TestCase):
    def test_parallel_feeds_keep_sessions_isolated_and_do_not_fetch_twice(self):
        barriers = {name: threading.Barrier(7) for name in ('A', 'B')}
        calls = []

        def download(path, page):
            self.assertEqual(loader._active.get()['path'], path)
            calls.append((path, page))
            barriers[path].wait(timeout=5)
            return (path, page)

        class Session:
            name = 'Qualifying'
            _RACE_LIKE_SESSIONS = ('Race',)
            def __init__(self, path):
                self.api_path = path
                self._ergast = SimpleNamespace(get_lap_times=lambda: None)
            def _drivers_results_from_ergast(self, **kwargs):
                return self.api_path
            def load(self, **kwargs):
                for name, page in loader._PAGES.items():
                    if page != 'lap_count':
                        self.assertion = getattr(_api, name)(self.api_path)
                        assert self.assertion == (self.api_path, page)
                assert self._drivers_results_from_ergast() == self.api_path

        def event(year, gp, **kwargs):
            return SimpleNamespace(get_session=lambda _: Session(gp))

        parsers = {page: (lambda path, response: response) for page in loader._PAGES.values()}
        with patch.object(loader.fastf1, 'get_event', event), \
             patch.object(loader, 'download_feed', download), \
             patch.dict(loader._PARSERS, parsers), ThreadPoolExecutor(2) as pool:
            results = list(pool.map(lambda gp: loader.load_fresh_session(2026, gp, 'Q'), ('A', 'B')))
        self.assertEqual(len(calls), 14)
        self.assertEqual(len(set(calls)), 14)
        self.assertIsNone(loader._active.get())
        self.assertEqual([r._drivers_results_from_ergast() for r in results], ['A', 'B'])

    def test_failed_resolution_resets_fresh_context(self):
        with patch.object(loader.fastf1, 'get_event', side_effect=ValueError('missing')):
            with self.assertRaises(ValueError):
                loader.load_fresh_session(2026, 'missing', 'Q')
        self.assertIsNone(loader._active.get())


if __name__ == '__main__':
    unittest.main()
