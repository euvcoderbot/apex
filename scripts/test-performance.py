"""Small deterministic checks for the performance calculations."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import unittest
from unittest.mock import patch
import numpy as np
from performance import analyze, clean, slope, traffic_gaps, telemetry_metrics, matched_tyre_trend
from performance_tracks import prepare, align, straight_braking_windows


def lap(driver='A', team='Alpha', time=90, **kwargs):
    return {'driver':driver,'team':team,'time':time,'phase':'Q1','accurate':True,
            'pit':False,'deleted':False,'track':'1','compound':'SOFT','rain':False,
            'sectors':[30,30,30],'lap':5,'start':400,'end':490,'age':5,'stint':1,**kwargs}


class Session:
    name='Qualifying'
    _QUALI_LIKE_SESSIONS=('Qualifying',)
    event={'EventName':'Test GP'}
    drivers=['A','B','C']
    def get_driver(self,code):
        times={'A':90,'B':91,'C':92}
        return {'Abbreviation':code,'TeamName':'Alpha' if code in ('A','B') else 'Beta',
                'TeamColor':'888888','Q1':times[code],
                'Q2':89 if code=='A' else (90 if code=='C' else None), 'Q3':None}


class RaceSession:
    name='Race'
    _QUALI_LIKE_SESSIONS=('Qualifying',)
    event={'EventName':'Test GP'}
    drivers=['A','B','C','D']
    def get_driver(self,code):
        return {'Abbreviation':code,'TeamName':{'A':'Alpha','B':'Alpha','C':'Beta','D':'Gamma'}[code],
                'TeamColor':'888888','Status':'Finished','Points':0,'Position':ord(code)-64}


class PerformanceTests(unittest.TestCase):
    def test_straight_braking_window_stops_at_turn_in(self):
        grid = np.arange(0.0, 1005.0, 5.0)
        theta = np.maximum(0.0, grid - 600.0) / 100.0
        x = np.where(grid <= 600, grid, 600 + 100 * np.sin(theta))
        y = np.where(grid <= 600, 0, 100 * (1 - np.cos(theta)))
        a = np.zeros((len(grid), 8))
        a[:, 5], a[:, 6] = x, y
        item = {'a': a, 'gps': np.ones(len(grid), dtype=bool), 'aligned': grid,
                'brake': (grid >= 500) & (grid < 680),
                'speed': 300 - np.clip(grid - 500, 0, 180) * 1.0}
        zones = [{'start': 90, 'apex': 150, 'corner': 'T1'}]
        windows = straight_braking_windows({'A': item, 'B': item, 'C': item}, item, grid, zones)
        self.assertIn('T1', windows)
        start, turn_in, onsets = windows['T1']
        self.assertLessEqual(grid[start], 505)
        self.assertGreaterEqual(grid[turn_in], 575)
        self.assertLessEqual(grid[turn_in], 625)
        self.assertEqual(len(onsets), 3)

    def test_gps_endpoint_clamping_keeps_positive_elapsed_cells(self):
        samples = lambda shift: [
            {'Distance': i*10.0, 'ElapsedSeconds': i*90/119, 'Speed': 47.6,
             'Throttle': 80, 'Brake': 0, 'X': i*10.0+shift, 'Y': 0, 'DRS': 0}
            for i in range(120)]
        selection = {'time': 90, 'start': 0, 'end': 90}
        reference = prepare(samples(0), selection)
        shifted = prepare(samples(-15), selection)
        grid = np.linspace(0, 1190, 239)
        result = align(shifted, reference, grid)
        self.assertTrue(np.all(result['dt'] > 0))
        self.assertAlmostEqual(float(np.sum(result['dt'])), 90)

    def test_tyre_trend_removes_common_race_lap_evolution(self):
        rows=[]
        for i in range(20):
            race_lap=i+5
            common=90-.06*race_lap
            rows.append({'team':'A','driver':'A','stint':1,'compound':'SOFT',
                         'lap':race_lap,'age':i+1,'time':common+.05*(i+1)})
            for peer in ('B','C','D'):
                rows.append({'team':peer,'driver':peer,'stint':1,'compound':'SOFT',
                             'lap':race_lap,'age':i+1,'time':common})
        estimate,count,peers=matched_tyre_trend([r for r in rows if r['team']=='A'],rows,'A')
        self.assertAlmostEqual(estimate,.05,places=4)
        self.assertEqual(count,20)
        self.assertEqual(peers,3)
        self.assertIsNone(matched_tyre_trend([r for r in rows if r['team']=='A'],
                                              [r for r in rows if r['team'] in ('A','B')],'A')[0])

    def test_fastest_teammate_and_phase(self):
        rows=[lap(),lap('B',time=91),lap('C','Beta',92),
              lap('A',time=89,phase='Q2'),lap('C','Beta',90,phase='Q2')]
        with patch('performance.records',return_value=rows):
            result=analyze(Session())
        a,b=result['teams']
        self.assertEqual(a['lap']['driver'],'A')
        self.assertAlmostEqual(a['pace'],0)
        self.assertAlmostEqual(b['pace'],(90/89-1)*100)
        self.assertEqual(a['phase_count'],2)

    def test_unofficial_deleted_fast_lap_not_selected(self):
        with patch('performance.records',return_value=[lap(time=80),lap()]):
            result=analyze(Session())
        self.assertEqual(result['teams'][0]['lap']['time'],90)

    def test_historical_dry_compound_and_official_time_are_valid(self):
        old=lap(compound='ULTRASOFT',accurate=False,track='')
        with patch('performance.records',return_value=[old]):
            result=analyze(Session())
        self.assertEqual(result['teams'][0]['phase_count'],1)

    def test_wet_unknown_weather_and_flags_excluded(self):
        self.assertTrue(clean(lap()))
        for changes in ({'rain':None},{'rain':True},{'track':'14'},{'pit':True},{'deleted':True},{'compound':'INTERMEDIATE'}):
            self.assertFalse(clean(lap(**changes)))

    def test_traffic_gap_includes_lapped_car(self):
        rows=[lap('B',lap=2,end=399),lap('B',lap=3,end=489),lap()]
        self.assertEqual(traffic_gaps(rows)[('A',5)],1)

    def test_race_pace_uses_fastest_teammate_not_team_average(self):
        base={'A':90,'B':96,'C':91,'D':92}
        rows=[lap(driver,{'A':'Alpha','B':'Alpha','C':'Beta','D':'Gamma'}[driver],
                  time=base[driver]+number*.03,lap=number,age=number,phase=None,
                  start=number*100,end=number*100+base[driver])
              for driver in base for number in range(3,15)]
        clear={(row['driver'],row['lap']):10 for row in rows}
        with patch('performance.records',return_value=rows), patch('performance.traffic_gaps',return_value=clear):
            result=analyze(RaceSession())
        alpha=next(team for team in result['teams'] if team['team']=='Alpha')
        self.assertEqual(alpha['fastest_race_driver'],'A')
        self.assertAlmostEqual(alpha['pace'],0,places=6)
        self.assertEqual(alpha['samples'],12)
        self.assertEqual([driver['driver'] for driver in alpha['race_drivers']], ['A', 'B'])
        self.assertGreater(alpha['teammate_spread'], 0)

    def test_missing_sectors_do_not_remove_official_qualifying_lap(self):
        rows = [lap('A', time=90, sectors=[30, None, 30]),
                lap('B', time=91), lap('C', 'Beta', 92)]
        with patch('performance.records', return_value=rows):
            result = analyze(Session())
        alpha = result['teams'][0]
        self.assertEqual(alpha['lap']['time'], 90)
        self.assertIsNone(alpha['sector_deficits'][1])

    def test_wet_qualifying_result_does_not_become_dry_trace(self):
        rows = [lap('A', time=90, compound='INTERMEDIATE', rain=True),
                lap('B', time=91, compound='SOFT', rain=False)]
        with patch('performance.records', return_value=rows):
            result = analyze(Session())
        alpha = result['teams'][0]
        self.assertEqual(alpha['lap']['compound'], 'INTERMEDIATE')
        self.assertEqual(alpha['telemetry_candidates'], [])

    def test_historical_retirement_note_not_applied_to_another_year(self):
        from performance import get_verified_retirement
        self.assertIsNone(get_verified_retirement('Chinese Grand Prix', 'STR', 2021))

    def test_aligned_zone_time_follows_measured_elapsed_channel(self):
        distance = np.linspace(0, 5000, 101)
        speed = np.where(distance < 2500, 200.0, 180.0)
        elapsed = np.r_[0.0, np.cumsum(np.diff(distance) * 3.6 / speed[1:])]
        samples = [
            {'Distance': float(d), 'ElapsedSeconds': float(t), 'Speed': float(v),
             'Throttle': 100, 'Brake': False, 'X': float(d * 10), 'Y': 0, 'DRS': 0}
            for d, t, v in zip(distance, elapsed, speed)
        ]
        selection = {'time': float(elapsed[-1]), 'start': 0, 'end': float(elapsed[-1])}
        item = prepare(samples, selection)
        result = align(item, item, np.linspace(0, 5000, 1001))
        self.assertAlmostEqual(float(result['dt'].sum()), selection['time'], places=6)
        self.assertAlmostEqual(float(result['dt'][:500].sum()), float(elapsed[50]), places=4)

    def test_slope_and_insufficient_span(self):
        self.assertAlmostEqual(slope([(i,90+i*.2) for i in range(10)]),.2)
        self.assertIsNone(slope([(1,90)]*6))

    def test_telemetry_gap_rejected(self):
        rows=[{'Distance':i*10,'Speed':180,'ElapsedSeconds':i*.2} for i in range(50)]
        self.assertEqual(telemetry_metrics(rows,[])['top_speed'],180)
        rows[30]['ElapsedSeconds']=20
        with self.assertRaises(ValueError):
            telemetry_metrics(rows,[])

    def test_braking_units(self):
        rows=[{'Distance':i*10,'Speed':300-i*3 if i<30 else 210,'ElapsedSeconds':i*.2,
               'Brake':i<30,'Throttle':100 if i>=30 else 0} for i in range(60)]
        zone=telemetry_metrics(rows,[])['braking'][0]
        self.assertAlmostEqual(zone['mean_g'],90/3.6/6/9.80665)

    def test_year_aware_mgu_h_exclusion(self):
        from performance import classify_retirement
        # 2025: MGU-H is a legitimate PU failure component
        res_2025 = classify_retirement('MGU-H failure', 'Australian Grand Prix', 'TEST', session_year=2025)
        self.assertEqual(res_2025['category'], 'PU-related')
        self.assertTrue(res_2025['year_compliant'])

        # 2026+: MGU-H does not exist in the regulations; must be rejected from PU-related
        res_2026 = classify_retirement('MGU-H failure', 'Australian Grand Prix', 'TEST', session_year=2026)
        self.assertEqual(res_2026['category'], 'Unknown / unverified')
        self.assertFalse(res_2026['year_compliant'])

    def test_ideal_vs_complete_gap_calculation(self):
        # Driver A does lap 1: S1=30, S2=31, S3=30 (total 91)
        # Driver A does lap 2: S1=31, S2=30, S3=30 (total 91)
        # Ideal: 30 + 30 + 30 = 90. Gap: 91 - 90 = 1.0s
        l1 = lap('A', time=91, sectors=[30, 31, 30], lap=1, compound='SOFT')
        l2 = lap('A', time=91, sectors=[31, 30, 30], lap=2, compound='SOFT')
        with patch('performance.records', return_value=[l1, l2]):
            result = analyze(Session())
        team = result['teams'][0]
        self.assertAlmostEqual(team['ideal_lap_time'], 90.0)
        self.assertAlmostEqual(team['ideal_vs_complete_gap_s'], 1.0)

    def test_leader_traffic_null_and_proximity_veto(self):
        # Leader car L alone on track -> clean air
        leader_laps = [
            {'driver': 'VER', 'lap': 10, 'start': 1000, 'end': 1090, 'sectors': [30, 30, 30]},
            {'driver': 'VER', 'lap': 11, 'start': 1090, 'end': 1180, 'sectors': [30, 30, 30]}
        ]
        gaps_leader = traffic_gaps(leader_laps, leader_abbr='VER')
        self.assertGreater(gaps_leader[('VER', 11)], 10.0)

        # But if lapped car 'BOT' crosses Sector 1 only 1.2s ahead of VER, proximity veto triggers
        lapped_crossings = [
            {'driver': 'VER', 'lap': 10, 'start': 1000, 'end': 1090, 'sectors': [30, 30, 30]},
            {'driver': 'VER', 'lap': 11, 'start': 1090, 'end': 1180, 'sectors': [30, 30, 30]},
            # VER Sector 1 stamp is 1090 + 30 = 1120. BOT Sector 1 crossing at 1118.8 (gap = 1.2s)
            {'driver': 'BOT', 'lap': 10, 'start': 1088.8, 'end': 1188.8, 'sectors': [30, 30, 40]}
        ]
        gaps_vetoed = traffic_gaps(lapped_crossings, leader_abbr='VER')
        self.assertAlmostEqual(gaps_vetoed[('VER', 11)], 1.2)

    def test_used_start_and_low_sample_separation(self):
        # 15 laps with starting tyre age 10: low_sample must be False, used_start must be True
        rows = [lap('A', 'Alpha', time=90 + i * 0.05, lap=i + 3, age=i + 10, stint=1) for i in range(15)]
        clear = {(r['driver'], r['lap']): 10.0 for r in rows}
        with patch('performance.records', return_value=rows), patch('performance.traffic_gaps', return_value=clear):
            res = analyze(RaceSession())
        stint = res['teams'][0]['degradation'][0]
        self.assertFalse(stint['low_sample'])
        self.assertTrue(stint['used_start'])
        self.assertEqual(stint['samples'], 15)
        self.assertEqual(stint['age_span'], 14)

    def test_development_progression_huber(self):
        from performance import compute_development_progression
        # Linear progression with one extreme outlier
        rounds_data = [{'round': r, 'deficit': 0.50 - 0.01 * (r - 1)} for r in range(1, 21)]
        # Add extreme outlier at round 15
        rounds_data[14]['deficit'] = 1.80
        res = compute_development_progression(rounds_data)
        # Huber progression rate should be close to -0.010
        self.assertAlmostEqual(res['progression_rate'], -0.010, places=2)
        self.assertEqual(res['sample_tier'], 'robust')
        # Modelled shift must equal progression_rate * (20 - 1) = -0.190
        self.assertAlmostEqual(res['modelled_shift'], round(res['progression_rate'] * 19.0, 3))


if __name__=='__main__':
    unittest.main()

