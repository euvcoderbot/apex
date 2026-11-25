"""Circuit-local forecast boundaries and session detail regression; no network."""
import copy
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import season_data as sd


class ForecastTests(unittest.TestCase):
    def test_previous_local_evening_is_included_without_extra_weekend_days(self):
        utc_day = (datetime.now(timezone.utc) + timedelta(days=5)).date()
        local_day = utc_day - timedelta(days=1)
        first_hour = f'{local_day}T16:00'
        second_hour = f'{local_day}T17:00'
        round_ = {'lat': 36, 'lon': -115, 'start': f'{utc_day}T00:30:00Z',
                  'sessions': [{'name': 'Practice 1', 'start': f'{utc_day}T00:30:00Z'}]}
        seen = []

        def fetch(url):
            seen.append(parse_qs(urlsplit(url).query))
            return {'utc_offset_seconds': -28800,
                    'hourly': {'time': [first_hour, second_hour], 'temperature_2m': [13, 14],
                               'precipitation_probability': [40, 43], 'precipitation': [0.1, 0.2],
                               'wind_speed_10m': [10, 12], 'wind_gusts_10m': [18, 22],
                               'wind_direction_10m': [260, 270], 'relative_humidity_2m': [48, 52],
                               'weather_code': [2, 51]},
                    'daily': {'time': [str(local_day), str(utc_day)], 'temperature_2m_max': [15, 16],
                              'temperature_2m_min': [8, 9], 'precipitation_probability_max': [43, 10],
                              'wind_speed_10m_max': [12, 9], 'weather_code': [51, 2]}}

        days = sd.weather(fetch, round_)
        self.assertEqual(seen[0]['start_date'], [str(local_day)])
        self.assertEqual([d['date'] for d in days], [str(local_day)])
        self.assertEqual(round_['sessions'][0]['weather'], {'temp': 14, 'rain': 43, 'wind': 12, 'code': 51,
                                                         'gust': 22, 'mm': 0.3, 'humidity': 50, 'direction': 260})

    def test_forecast_end_stays_within_provider_range(self):
        utc_day = (datetime.now(timezone.utc) + timedelta(days=15)).date()
        round_ = {'lat': 36, 'lon': -115, 'start': f'{utc_day}T00:30:00Z',
                  'sessions': [{'start': f'{utc_day}T00:30:00Z'}]}
        seen = []
        sd.weather(lambda url: seen.append(parse_qs(urlsplit(url).query)) or {}, copy.deepcopy(round_))
        self.assertEqual(seen[0]['end_date'], [str(utc_day)])


if __name__ == '__main__':
    unittest.main()
