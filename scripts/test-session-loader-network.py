"""Failure modes of the timing-feed download and indexing in session_loader, with the network replaced.

The loader has to cope with a primary host that is down or answering errors, a mirror that has the data, feeds that have never
been published, byte-order marks, malformed lines, records out of order, and windows that touch their bounds. None of this needs
the network: fresh_get is the one function that talks to it.
"""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import requests
import session_loader as loader

PAGE = next(iter(loader._api.pages))


class Response:
    def __init__(self, status=200, body=b''):
        self.status_code, self.content = status, body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f'{self.status_code} error')


def record(stamp, payload='{"a": 1}'):
    return f'{stamp}{payload}'


GOOD = '\n'.join([record('00:00:01.000'), record('00:00:02.000', '{"a": 2}')]).encode('utf-8')


def fetcher(*answers):
    """A fresh_get that gives each call the next answer (an exception is raised) and remembers the hosts it was asked for."""
    calls = []

    def get(url, **kwargs):
        calls.append(url)
        answer = answers[min(len(calls), len(answers)) - 1]
        if isinstance(answer, Exception):
            raise answer
        return answer
    get.calls = calls
    return get


class DownloadFeedTests(unittest.TestCase):
    def test_a_normal_answer_is_parsed_and_the_mirror_is_not_touched(self):
        get = fetcher(Response(200, GOOD))
        with patch.object(loader, 'fresh_get', get):
            records = loader.download_feed('Static/x/', PAGE)
        self.assertEqual([r[0] for r in records], ['00:00:01.000', '00:00:02.000'])
        self.assertEqual(len(get.calls), 1)
        self.assertTrue(get.calls[0].startswith(loader._api.base_url))

    def test_an_error_from_the_primary_host_falls_back_to_the_mirror(self):
        get = fetcher(Response(503), Response(200, GOOD))
        with patch.object(loader, 'fresh_get', get):
            records = loader.download_feed('Static/x/', PAGE)
        self.assertEqual(len(records), 2)
        self.assertTrue(get.calls[1].startswith(loader._api.base_url_mirror))

    def test_a_network_failure_on_the_primary_host_falls_back_to_the_mirror(self):
        for error in (requests.ConnectionError('down'), requests.Timeout('slow')):
            get = fetcher(error, Response(200, GOOD))
            with patch.object(loader, 'fresh_get', get):
                records = loader.download_feed('Static/x/', PAGE)
            self.assertEqual(len(records), 2, type(error).__name__)

    def test_a_feed_missing_on_both_hosts_raises_instead_of_returning_nothing(self):
        get = fetcher(Response(404), Response(404))
        with patch.object(loader, 'fresh_get', get), self.assertRaises(requests.HTTPError):
            loader.download_feed('Static/x/', PAGE)

    def test_both_hosts_down_raises(self):
        get = fetcher(requests.ConnectionError('down'), requests.ConnectionError('also down'))
        with patch.object(loader, 'fresh_get', get), self.assertRaises(requests.ConnectionError):
            loader.download_feed('Static/x/', PAGE)

    def test_a_byte_order_mark_blank_lines_and_malformed_records_are_tolerated(self):
        body = ('﻿' + record('00:00:01.000') + '\n\n' + record('00:00:02.000', '{not json') + '\n' + record('00:00:03.000')).encode('utf-8')
        with patch.object(loader, 'fresh_get', fetcher(Response(200, body))):
            records = loader.download_feed('Static/x/', PAGE)
        self.assertEqual([r[0] for r in records], ['00:00:01.000', '00:00:03.000'], 'the malformed line is skipped, the rest kept')

    def test_an_empty_feed_is_an_empty_list(self):
        with patch.object(loader, 'fresh_get', fetcher(Response(200, b''))):
            self.assertEqual(loader.download_feed('Static/x/', PAGE), [])

    def test_the_stream_download_has_the_same_fallback_and_failure_behaviour(self):
        with patch.object(loader, 'fresh_get', fetcher(Response(503), Response(200, GOOD))):
            self.assertEqual(len(loader._download_stream('Static/x/', PAGE)), 2)
        with patch.object(loader, 'fresh_get', fetcher(Response(404), Response(404))), self.assertRaises(requests.HTTPError):
            loader._download_stream('Static/x/', PAGE)


class IndexedRecordsTests(unittest.TestCase):
    def records(self):
        return [record(s) for s in ('00:00:03.000', '00:00:01.000', '00:00:02.000', '00:00:05.000', '00:00:04.000')]

    def test_records_are_sorted_by_feed_time_whatever_order_they_arrive_in(self):
        index = loader._IndexedRecords(self.records())
        self.assertEqual(index.times, [1., 2., 3., 4., 5.])
        self.assertEqual([r[:12] for r in index], sorted(r[:12] for r in self.records()))

    def test_short_or_unparseable_records_are_dropped(self):
        index = loader._IndexedRecords(['short', record('not a time'), record('00:00:01.000')])
        self.assertEqual(index.times, [1.])

    def test_a_window_includes_both_bounds_and_nothing_outside_them(self):
        index = loader._IndexedRecords(self.records())
        self.assertEqual([r[:12] for r in index.window(2., 4.)], ['00:00:02.000', '00:00:03.000', '00:00:04.000'])
        self.assertEqual(index.window(6., 9.), [])
        self.assertEqual(index.window(4., 2.), [])
        self.assertEqual(len(index.window(0., 99.)), 5)

    def test_an_empty_index_has_empty_windows(self):
        self.assertEqual(loader._IndexedRecords([]).window(0., 10.), [])


if __name__ == '__main__':
    unittest.main()
