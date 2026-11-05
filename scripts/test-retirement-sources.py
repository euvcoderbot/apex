"""Retirement causes come from the race (not sprint) classification on Wikipedia, only when they match the timing data."""
from pathlib import Path
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import retirement_sources as sources
from performance import classify_retirement

# The shape of a real article (2026 Mexico City and Barcelona-Catalunya Grands Prix): a qualifying table, a sprint table that
# must be ignored, and the race table with retired, classified-but-stopped and not-classified cars.
WIKITEXT = """
=== Qualifying classification ===
{| class="wikitable"
! {{Tooltip|Pos.|Position}} !! {{Tooltip|No.|Car number}} !! Driver !! Constructor !! Q1 !! Q2 !! Q3 !! Grid
|-
! 1 || 44 || [[Lewis Hamilton]] || Ferrari || 1:16.9 || 1:16.6 || 1:16.5 || 1
|}
=== Sprint classification ===
{| class="wikitable"
! {{Tooltip|Pos.|Position}} !! {{Tooltip|No.|Car number}} !! Driver !! Constructor !! {{Tooltip|Laps|Laps completed}} !! Time/Retired !! Grid !! Points
|-
!Ret
| align="center" |14
| [[Fernando Alonso]] || Aston Martin || 3 || Sprint-only reason || 9 ||
|}
=== Race classification ===
{| class="wikitable sortable" style="font-size: 85%;"
! scope="col" |{{Tooltip|Pos.|Position}}
! scope="col" |{{Tooltip|No.|Car number}}
! scope="col" |Driver
! scope="col" |Constructor
! class="unsortable" scope="col" |{{Tooltip|Laps|Laps completed}}
! class="unsortable" scope="col" |Time/Retired
! scope="col" |{{Tooltip|Grid|Starting grid position}}
! scope="col"|Points
|-
!1
| align="center" |3
| data-sort-value="ver" |{{flagicon|NED}} '''[[Max Verstappen]]'''
|'''{{nowrap|[[Red Bull Racing]]-[[Red Bull Powertrains|Red Bull Ford]]}}'''
| align="center" |71
| 2:20:28.772
| align="center" |5
| align="center" |'''25'''
|-
!6
| align="center" |6
| [[Isack Hadjar]] || Red Bull Racing || 65 || +1 lap || 6 || 8
|-
!15
| align="center" |16
| [[Charles Leclerc]] || Ferrari || 62 || Hydraulics<ref>{{cite web|url=https://example.org}}</ref> || 10 ||
|-
!NC
| align="center" |23
| [[Alexander Albon]] || Williams || 55 || +11 laps || 18 ||
|-
!data-sort-value="21"|{{abbr|Ret|Retired}}
| align="center" |11
| data-sort-value="per" |{{flagicon|MEX}} [[Sergio Pérez]]
|[[Cadillac in Formula One|Cadillac]]-[[Scuderia Ferrari|Ferrari]]
| align="center" |31
| {{nowrap|Water pressure}}
| align="center" |19
|
|-
!data-sort-value="22"|{{abbr|Ret|Retired}}
| align="center" |18
| [[Lance Stroll]] || Aston Martin || 5 || Engine || 21 ||
|}
"""


class Parsing(unittest.TestCase):
    def test_race_table_only_with_retired_and_classified_but_stopped_cars(self):
        rows = {r['number']: r for r in sources.parse_classification(WIKITEXT)}
        self.assertEqual(set(rows), {'16', '11', '18'}, 'finishers, lapped cars and not-classified gaps are not causes; the sprint row is ignored')
        self.assertEqual(rows['16']['reason'], 'Hydraulics', 'references are stripped')
        self.assertEqual(rows['16']['position'], '15', 'a car classified after stopping keeps its position')
        self.assertEqual(rows['11']['reason'], 'Water pressure')
        self.assertEqual(rows['11']['laps'], 31)
        self.assertIn('Pérez', rows['11']['driver'])
        self.assertEqual(rows['18']['position'], 'Ret')

    def test_no_classification_table_means_no_causes(self):
        self.assertEqual(sources.parse_classification('== Background ==\nNo table yet.'), [])


class Matching(unittest.TestCase):
    report = {'url': 'https://en.wikipedia.org/w/index.php?title=X&oldid=1', 'retirements': sources.parse_classification(WIKITEXT)}

    def test_number_surname_and_laps_must_agree(self):
        self.assertEqual(sources.match(self.report, 11, 'Perez', 31)['reason'], 'Water pressure', 'accents do not matter')
        self.assertEqual(sources.match(self.report, '18', 'Stroll', 6)['reason'], 'Engine', 'one lap of difference is tolerated')
        self.assertIsNone(sources.match(self.report, 18, 'Alonso', 5), 'a different driver in that car is rejected')
        self.assertIsNone(sources.match(self.report, 18, 'Stroll', 40), 'a different retirement lap is rejected')
        self.assertIsNone(sources.match(self.report, 44, 'Hamilton', 71), 'a finisher has no reported cause')
        self.assertIsNone(sources.match(None, 18, 'Stroll', 5))

    def test_switched_off_means_no_network_and_no_report(self):
        with mock.patch.dict(os.environ, {'APEX_RETIREMENT_SOURCES': 'off'}), mock.patch.object(sources, '_api') as api:
            self.assertIsNone(sources.reported_retirements(2026, 'Mexico City Grand Prix'))
        api.assert_not_called()


class Classification(unittest.TestCase):
    def reported(self, reason):
        return {'reason': reason, 'url': 'https://en.wikipedia.org/w/index.php?title=X&oldid=1'}

    def test_reported_causes_are_labelled_and_linked_not_verified(self):
        info = classify_retirement('Retired', 'Mexico City Grand Prix', 'STR', 2026, self.reported('Engine'))
        self.assertEqual((info['category'], info['cause'], info['source'], info['verified']), ('PU-related', 'Engine', 'Wikipedia race classification', False))
        self.assertTrue(info['source_url'].startswith('https://en.wikipedia.org/'))

    def test_categories_for_reasons_as_wikipedia_words_them(self):
        cases = {'Collision damage': 'Incident / collision', 'Accident': 'Incident / collision', 'Hydraulics': 'Chassis / team-related',
                 'Gearbox': 'Chassis / team-related', 'Water pressure': 'PU-related', 'Power loss': 'PU-related', 'Battery': 'PU-related',
                 'Positive COVID-19 test': 'Other confirmed', 'Safety switch': 'Unknown / unverified'}
        for reason, category in cases.items():
            self.assertEqual(classify_retirement('Retired', 'X', 'AAA', 2026, self.reported(reason))['category'], category, reason)

    def test_without_a_report_the_timing_status_stays_unknown(self):
        info = classify_retirement('Retired', 'X', 'AAA', 2026)
        self.assertEqual((info['category'], info['source'], info['source_url']), ('Unknown / unverified', 'Official Timing', None))


if __name__ == '__main__':
    unittest.main()
