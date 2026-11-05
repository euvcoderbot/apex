"""A stand-in driver listed without a team is filled from the same weekend, and such a list is never saved as final."""
import gzip
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server

# Mexico City 2026: OpenF1's race list first named Hirakawa (car 50, standing in for Ocon) with no team; practice and qualifying named Haas.
RACE = [{'meeting_key': 1298, 'session_key': 11404, 'driver_number': 50, 'name_acronym': 'HIR', 'team_name': None, 'team_colour': None},
        {'meeting_key': 1298, 'session_key': 11404, 'driver_number': 87, 'name_acronym': 'BEA', 'team_name': 'Haas F1 Team', 'team_colour': '9C9FA2'}]
WEEKEND = [{'meeting_key': 1298, 'session_key': 11397, 'driver_number': 50, 'name_acronym': 'HIR', 'team_name': 'Haas F1 Team', 'team_colour': '9C9FA2'},
           {'meeting_key': 1298, 'session_key': 11398, 'driver_number': 31, 'name_acronym': 'OCO', 'team_name': 'Haas F1 Team', 'team_colour': '9C9FA2'}]


def rows(data):
    return json.loads(json.dumps(data))


class StandInIdentity(unittest.TestCase):
    def test_missing_team_comes_from_the_same_car_number_that_weekend(self):
        with mock.patch.object(server, '_openf1_fetch', return_value=rows(WEEKEND)) as fetch:
            filled = server._fill_driver_identities(rows(RACE))
        self.assertIn('meeting_key=1298', fetch.call_args[0][0])
        self.assertEqual(filled[0]['team_name'], 'Haas F1 Team')
        self.assertEqual(filled[0]['team_colour'], '9C9FA2')
        self.assertTrue(server._driver_rows_complete(filled))

    def test_a_complete_list_asks_nothing_and_an_unknown_number_stays_unknown(self):
        complete = rows(RACE[1:])
        with mock.patch.object(server, '_openf1_fetch') as fetch:
            self.assertEqual(server._fill_driver_identities(complete), complete)
        fetch.assert_not_called()
        stranger = [{**RACE[0], 'driver_number': 99}]
        with mock.patch.object(server, '_openf1_fetch', return_value=rows(WEEKEND)):
            self.assertIsNone(server._fill_driver_identities(stranger)[0]['team_name'])

    def test_an_incomplete_saved_list_is_asked_again_and_only_a_complete_one_is_saved(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'drivers.json.gz'
            with gzip.open(path, 'wt', encoding='utf-8') as handle:
                json.dump(RACE, handle)
            fixed = [{**RACE[0], 'team_name': 'Haas F1 Team', 'team_colour': '9C9FA2'}, RACE[1]]
            with mock.patch.object(server, 'openf1_cache_path', return_value=path), \
                    mock.patch.object(server, '_openf1_session_settled', return_value=True), \
                    mock.patch.object(server, '_openf1_fetch', return_value=rows(fixed)) as fetch:
                result = server.openf1('drivers', session_key=11404)
            fetch.assert_called_once()
            self.assertEqual(result[0]['team_name'], 'Haas F1 Team')
            with gzip.open(path, 'rt', encoding='utf-8') as handle:
                self.assertEqual(json.load(handle)[0]['team_name'], 'Haas F1 Team')

    def test_when_openf1_refuses_the_saved_list_is_still_used(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'drivers.json.gz'
            with gzip.open(path, 'wt', encoding='utf-8') as handle:
                json.dump(RACE, handle)
            with mock.patch.object(server, 'openf1_cache_path', return_value=path), \
                    mock.patch.object(server, '_openf1_session_settled', return_value=True), \
                    mock.patch.object(server, '_openf1_fetch', side_effect=OSError('401 during a live session')):
                result = server.openf1('drivers', session_key=11404)
            self.assertEqual([row['name_acronym'] for row in result], ['HIR', 'BEA'])


if __name__ == '__main__':
    unittest.main()
