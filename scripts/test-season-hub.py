"""Season hub (season_data.py, fia_documents.py): paging, standings with countback, driver stats, head-to-heads and the
FIA document helpers. No network: Jolpica pages and FIA listings come from injected fakes."""
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fia_documents as fia
import season_data as sd

TEAMS = {'ver': ('red_bull', 'Red Bull'), 'had': ('red_bull', 'Red Bull'), 'law': ('rb', 'RB F1 Team'), 'lin': ('rb', 'RB F1 Team')}
POINTS = {1: 25, 2: 18, 3: 15, 4: 12}


def row(driver, position, grid=1, laps=50, millis=None, status='Finished', points=None):
    team, name = TEAMS[driver]
    classified = isinstance(position, int)
    out = {'position': str(position if classified else 4), 'positionText': str(position), 'grid': str(grid),
           'points': str((POINTS.get(position, 0) if classified else 0) if points is None else points),
           'laps': str(laps), 'status': status,
           'Driver': {'driverId': driver, 'code': driver.upper(), 'givenName': driver.title(), 'familyName': driver.title() + 'son',
                      'permanentNumber': str(len(driver))},
           'Constructor': {'constructorId': team, 'name': name}}
    if millis:
        out['Time'] = {'millis': str(millis)}
    return out


def quali(driver, position, q3=True):
    team, name = TEAMS[driver]
    return {'position': str(position), 'Q1': '1:20.000', 'Q2': '1:19.500', 'Q3': '1:19.000' if q3 else '',
            'Driver': {'driverId': driver, 'givenName': driver, 'familyName': driver.title()},
            'Constructor': {'constructorId': team, 'name': name}}


def race(n, date, **rows):
    return {'round': str(n), 'raceName': f'Grand Prix {n}', 'date': date, 'time': '13:00:00Z',
            'Circuit': {'circuitId': f'c{n}', 'circuitName': f'Circuit {n}',
                        'Location': {'locality': 'Town', 'country': 'Land', 'lat': '1', 'long': '2'}},
            **rows}


# Round 1: VER wins from LAW by 2.5 s; HAD retires. Round 2 (sprint weekend): LAW wins, VER second, LIN P3, HAD P4;
# VER wins the sprint (8 points). Drivers: VER 25+18+8 = 51, LAW 18+25 = 43. Teams: RB 18+15+25+15 = 73, Red Bull 25+18+12+8 = 63.
R1 = [row('ver', 1, millis=5_000_000), row('law', 2, grid=3, millis=5_002_500), row('lin', 3, millis=5_010_000),
      row('had', 'R', grid=2, laps=10, status='Engine')]
R2 = [row('law', 1, grid=2), row('ver', 2, grid=1), row('lin', 3), row('had', 4)]
SPRINT2 = [row('ver', 1, grid=1, points=8), row('law', 2, grid=2, points=0)]


def jolpica(url):
    path = url.split('/f1/2026/', 1)[1]

    def page(races, total=None):
        return {'MRData': {'total': str(total if total is not None else len(races)), 'RaceTable': {'Races': races}}}
    if path.startswith('races/'):
        return page([race(1, '2026-03-08'), race(2, '2026-03-15', Sprint={'date': '2026-03-14', 'time': '10:00:00Z'}),
                     race(3, '2099-03-22')])
    if path.startswith('results/'):
        # Round 2 straddles two pages: the merge must join both halves.
        if 'offset=0' in path:
            return page([race(1, '2026-03-08', Results=R1), race(2, '2026-03-15', Results=R2[:2])], total=150)
        return page([race(2, '2026-03-15', Results=R2[2:])], total=150)
    if path.startswith('qualifying/'):
        return page([race(1, '2026-03-08', QualifyingResults=[quali('ver', 1), quali('had', 2), quali('law', 3), quali('lin', 4, q3=False)]),
                     race(2, '2026-03-15', QualifyingResults=[quali('ver', 1), quali('law', 2), quali('had', 3), quali('lin', 4)])])
    if path.startswith('sprint/'):
        return page([race(2, '2026-03-15', SprintResults=SPRINT2)])
    if '/pitstops/' in path:
        n = int(path.split('/')[0])
        # Round 1: Red Bull 22.0 and 23.0, RB 24.0 (median 23.0). Round 2 (a longer pit lane): Red Bull 30.0, RB 31.0, 32.0, plus a 75 s stop that is left out.
        stops = {1: [('ver', '22.0'), ('had', '23.0'), ('law', '24.0')], 2: [('ver', '30.0'), ('law', '31.0'), ('lin', '32.0'), ('had', '1:15.000')]}[n]
        return page([{'round': str(n), 'PitStops': [{'driverId': d, 'lap': '10', 'stop': '1', 'duration': t} for d, t in stops]}])
    raise AssertionError(path)


def jolpica_global(url):
    path = url.split('/f1/', 1)[1]
    winner = lambda y, d, grid: {'season': str(y), 'Results': [{'grid': str(grid), 'Driver': {'driverId': d, 'givenName': d.title(), 'familyName': d.title()},
                                                                 'Constructor': {'constructorId': 'red_bull', 'name': 'Red Bull'}}]}
    pole = lambda y, d: {'season': str(y), 'QualifyingResults': [{'Driver': {'driverId': d, 'givenName': d.title(), 'familyName': d.title()}}]}
    if path.startswith('circuits/c3/results/1/'):
        return {'MRData': {'RaceTable': {'Races': [winner(2023, 'ver', 1), winner(2024, 'ver', 3), winner(2025, 'law', 1), winner(2026, 'had', 1)]}}}
    if path.startswith('circuits/c3/qualifying/1/'):
        return {'MRData': {'RaceTable': {'Races': [pole(2023, 'ver'), pole(2024, 'had'), pole(2025, 'law')]}}}
    raise AssertionError(path)


class SeasonDataTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.calls = []

        def fetch(url):
            cls.calls.append(url)
            return jolpica(url) if '/f1/2026/' in url else jolpica_global(url)
        cls.tmp = tempfile.TemporaryDirectory()
        cls.source = sd.Source(Path(cls.tmp.name), fetch=fetch)
        cls.summary = sd.build(2026, cls.source)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_paged_results_merge_by_round(self):
        self.assertEqual([x['driver'] for x in self.summary['rounds'][1]['race']], ['law', 'ver', 'lin', 'had'])

    def test_round_status(self):
        self.assertEqual([r['status'] for r in self.summary['rounds']], ['done', 'done', 'next'])
        self.assertTrue(self.summary['rounds'][1]['sprint_weekend'])

    def test_disk_cache_avoids_refetching(self):
        before = len(self.calls)
        sd.build(2026, self.source)
        self.assertEqual(len(self.calls), before)

    def test_short_team_names(self):
        self.assertEqual(self.summary['teams']['rb']['name'], 'Racing Bulls')
        self.assertEqual(sd.team_name('Cadillac F1 Team'), 'Cadillac')
        self.assertEqual(sd.team_name('Haas F1 Team'), 'Haas')
        self.assertEqual(sd.team_name('Red Bull'), 'Red Bull')

    def test_retirement_is_not_classified(self):
        had = next(x for x in self.summary['rounds'][0]['race'] if x['driver'] == 'had')
        self.assertIsNone(had['position'])
        self.assertEqual(self.summary['driver_stats']['had']['retirements'], 1)

    def test_standings_include_sprint_points(self):
        table = self.summary['standings']['drivers'][-1]['table']
        self.assertEqual([(e['id'], e['points']) for e in table[:2]], [('ver', 51.0), ('law', 43.0)])
        teams = self.summary['standings']['teams'][-1]['table']
        self.assertEqual([(e['id'], e['points']) for e in teams], [('rb', 73.0), ('red_bull', 63.0)])

    def test_countback_breaks_a_points_tie(self):
        rounds = [{'round': 1, 'race': [{'driver': 'a', 'team': 't', 'position': 2, 'points': 10.0},
                                        {'driver': 'b', 'team': 't', 'position': 1, 'points': 10.0}], 'sprint': []}]
        self.assertEqual([e['id'] for e in sd._standings_after(rounds, 'driver')[0]['table']], ['b', 'a'])

    def test_winning_margin_needs_race_times(self):
        self.assertEqual(self.summary['winners'][0]['margin'], 2.5)
        self.assertIsNone(self.summary['winners'][1]['margin'])

    def test_driver_stats(self):
        ver = self.summary['driver_stats']['ver']
        self.assertEqual((ver['starts'], ver['wins'], ver['podiums'], ver['poles'], ver['sprint_wins'], ver['points']),
                         (2, 1, 2, 2, 1, 51.0))
        self.assertEqual(ver['average_finish'], 1.5)
        self.assertEqual(ver['team_share'], round(51 / 63, 3))
        self.assertEqual([p['position'] for p in ver['position_after']], [1, 1])
        self.assertEqual(self.summary['driver_stats']['lin']['q3'], 1)

    def test_head_to_head_rules(self):
        h = sd.compare(self.summary, 'ver', 'had')
        self.assertEqual(h['tally']['race'], [2, 0])        # a classified finish beats a retirement
        self.assertEqual(h['tally']['qualifying'], [2, 0])
        both_out = {'rounds': [{'round': 1, 'qualifying': [], 'sprint': [],
                                'race': [{'driver': 'x', 'position': None}, {'driver': 'y', 'position': None}]}]}
        self.assertEqual(sd.compare(both_out, 'x', 'y')['tally']['race'], [0, 0])

    def test_pit_stops_against_each_rounds_median(self):
        ps = self.summary['pit_stops']
        self.assertEqual(ps['count'], 6)   # the 75 s stop is left out
        teams = {t['team']: t for t in ps['teams']}
        # Red Bull: 22-23 = -1, 23-23 = 0, 30-31 = -1 -> median -1. RB: 24-23 = +1, 31-31 = 0, 32-31 = +1 -> median +1.
        self.assertEqual((teams['red_bull']['vs_field'], teams['rb']['vs_field']), (-1.0, 1.0))
        self.assertEqual(ps['teams'][0]['team'], 'red_bull')
        self.assertEqual(ps['fastest'][0]['seconds'], 22.0)

    def test_circuit_history_before_this_season(self):
        h = self.summary['next_history']
        self.assertEqual(h['held'], 3)                  # the 2026 race is not history yet
        self.assertEqual([r['year'] for r in h['races']], [2025, 2024, 2023])
        self.assertEqual(h['most_wins'], {'driver': 'Ver Ver', 'wins': 2})
        self.assertEqual(h['won_from_pole'], 2)
        self.assertEqual(h['races'][1]['pole'], 'Had Had')

    def test_teammate_pairs(self):
        self.assertEqual({(p['a'], p['b']) for p in self.summary['teammates']}, {('had', 'ver'), ('law', 'lin')})


class FiaDocumentsTest(unittest.TestCase):
    def test_reason_type(self):
        self.assertEqual(fia.reason_type('Performance - Local Load'), 'Performance')
        self.assertEqual(fia.reason_type('', 'Circuit specific - Downforce'), 'Circuit specific')
        self.assertEqual(fia.reason_type('Reliability'), 'Reliability')
        self.assertEqual(fia.reason_type('', ''), 'Unspecified')

    def test_team_id(self):
        self.assertEqual(fia.team_id('Visa Cash App Racing Bulls F1 Team'), 'rb')
        self.assertEqual(fia.team_id('Oracle Red Bull Racing'), 'red_bull')
        self.assertEqual(fia.team_id('VISA CASH APP RB FORMULA ONE TEAM'), 'rb')
        self.assertEqual(fia.team_id('STAKE F1 TEAM KICK SAUBER'), 'sauber')
        self.assertIsNone(fia.team_id('Unknown'))

    def test_dates(self):
        self.assertEqual(fia._dates('06 - 08 November 2026'), ['2026-11-06', '2026-11-08'])
        self.assertEqual(fia._dates('30 October - 01 November 2026'), ['2026-10-30', '2026-11-01'])
        self.assertEqual(fia._dates('30 December - 01 January 2027'), ['2026-12-30', '2027-01-01'])
        self.assertIsNone(fia._dates('no dates here'))

    def test_document_names_in_both_eras(self):
        new = '/system/files/decision-document/2025_hungarian_grand_prix_-_car_presentation_submissions.pdf'
        old = '/sites/default/files/decision-document/2024 Hungarian Grand Prix - PU elements used per driver up to now.pdf'
        self.assertIn('car_presentation', fia.doc_kind(new))
        self.assertIn('pu_elements_used', fia.doc_kind(old))
        self.assertIn('pu_elements_used', fia.doc_kind(old.replace(' ', '%20')))

    def test_repair_item(self):
        shifted = fia.repair_item({'component': '', 'reason': '8', 'geometry': 'Floor Leading Edge', 'description': 'Performance - Local Load Reprofiled floor surfaces'})
        self.assertEqual((shifted['component'], shifted['reason'], shifted['geometry']), ('Floor Leading Edge', 'Performance - Local Load', 'Reprofiled floor surfaces'))
        self.assertEqual(fia.repair_item({'component': 'Rear Wing Rear Wing', 'reason': 'Performance', 'geometry': 'x', 'description': 'y'})['component'], 'Rear Wing')
        self.assertIsNone(fia.repair_item({'component': '', 'reason': '', 'geometry': '', 'description': ''}))

    def test_event_names_in_either_encoding(self):
        self.assertEqual(fia._unquote('S%C3%A3o%20Paulo'), 'São Paulo')
        self.assertEqual(fia._unquote('S%E3o%20Paulo'), 'São Paulo')

    def test_season_url_and_events_from_listing(self):
        pages = {fia.CHAMPIONSHIP: '<a href="/x/season/season-2025-2071">x</a><a href="/x/season/season-2026-2072">y</a>',
                 fia.CHAMPIONSHIP + '/season/season-2026-2072': '<a href="/a/event/Mexico%20City%20Grand%20Prix">m</a>'
                                                                 '<a href="/a/event/S%E3o%20Paulo%20Grand%20Prix">s</a>'}
        docs = fia.Documents(None, get=lambda url, binary=False: pages[url])
        self.assertTrue(docs.season_url(2026).endswith('season-2026-2072'))
        self.assertEqual(docs.events(2026), ['Mexico City Grand Prix', 'São Paulo Grand Prix'])
        with self.assertRaises(LookupError):
            docs.season_url(2030)


if __name__ == '__main__':
    unittest.main()
