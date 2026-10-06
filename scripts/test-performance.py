"""Small deterministic checks for the performance calculations."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import unittest
from unittest.mock import patch
import numpy as np
from performance import analyze, clean, slope, traffic_gaps, telemetry_metrics, matched_tyre_trend, fit_tyre_stint
from performance_tracks import prepare, align, straight_braking_windows, observed_braking_zones, matched_braking_measurements, braking_approach_measurements, straight_core_measurements


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
    def test_braking_fastest_lap_identity_does_not_fall_back(self):
        from performance_tracks import fastest_qualifying_braking_items
        fast={'team':'A:0','team_name':'A','time':90.,'driver':'VER','lap':10}
        slow={'team':'A:1','team_name':'A','time':90.3,'driver':'PER','lap':12}
        self.assertEqual(fastest_qualifying_braking_items([slow,fast],{'A':[{'selection':slow}]}),{})
        result=fastest_qualifying_braking_items([slow,fast],{'A':[{'selection':slow},{'selection':fast}]})
        self.assertEqual(result['A']['selection'],fast)
        # Fastest official lap absent from dry telemetry candidates is not
        # silently replaced with the fastest available dry lap.
        tagged={**slow,'qualifying_best_time':89.,'qualifying_best_driver':'VER','qualifying_best_lap':9}
        self.assertEqual(fastest_qualifying_braking_items([tagged],{'A':[{'selection':tagged}]}),{})

    def test_exact_telemetry_lap_edges_do_not_use_buffer_origin(self):
        from session_loader import _lap_samples
        rows=[{'date':100+i*.25,'Speed':180.,'Throttle':100.,'RPM':10000.,'Brake':False,'DRS':0,'nGear':6} for i in range(49)]
        samples=_lap_samples(rows,[],2.,10.,t0=100.)
        self.assertEqual(samples[0]['Timestamp'],102.)
        self.assertEqual(samples[-1]['Timestamp'],110.)
        self.assertEqual(samples[-1]['ElapsedSeconds'],8.)
        self.assertAlmostEqual(samples[-1]['Distance'],400.)

    def test_sector_registration_matches_official_timing_lines(self):
        from performance_tracks import timing_line_alignment
        ref=np.zeros((101,8));ref[:,0]=np.linspace(0,5000,101);ref[:,1]=np.linspace(0,90,101)
        item={'a':ref.copy(),'official':90.,'selection':{'sectors':[30.,30.,30.]}}
        other={'a':ref.copy(),'official':91.,'selection':{'sectors':[30.3,30.4,30.3]}}
        other['a'][:,1]=np.linspace(0,91,101)
        aligned,scale=timing_line_alignment(other,item,np.linspace(0,5000,1001))
        self.assertAlmostEqual(float(np.interp(30.3,other['a'][:,1],aligned)),5000/3,delta=.1)
        self.assertLess(scale,.03)
        other['selection']['sectors']=[10.,50.,31.]
        with self.assertRaises(ValueError):timing_line_alignment(other,item,np.linspace(0,5000,1001))

    def test_terminal_speed_uses_channel_not_warped_time(self):
        from performance_tracks import analyze_straights_speed_domain
        grid=np.linspace(0,500,101);a=np.zeros((101,8));a[:,0]=grid;a[:,1]=np.linspace(0,6,101);a[:,2]=300;a[:,3]=100
        selected={t:{'a':a.copy(),'aligned':grid,'speed':np.full(101,300.),'brake':np.zeros(101,dtype=bool),'dt':np.full(100,.001),'official':6.,'selection':{'start':0}} for t in 'ABC'}
        result=analyze_straights_speed_domain(selected,[(0,100)],grid,selected['A'],np.zeros(100,dtype=bool))
        for row in result.values():
            self.assertAlmostEqual(row['terminal_zone_mean_speed'],300.)
            self.assertEqual(row['terminal_zone_count'],1)
            self.assertAlmostEqual(row['terminal_zone_length_m'],80.)
        selected['C']['brake'][90]=True
        result=analyze_straights_speed_domain(selected,[(0,100)],grid,selected['A'],np.zeros(100,dtype=bool))
        self.assertTrue(all(row['terminal_zone_mean_speed'] is None for row in result.values()))

    def core_fixture(self):
        grid=np.arange(0.,1005.,5.);selected={}
        for team,speed in [('A',300.),('B',290.),('C',295.)]:
            a=np.zeros((len(grid),8));a[:,0]=grid;a[:,1]=grid*3.6/speed
            a[:,2]=speed;a[:,3]=100;a[:,5]=grid*10
            selected[team]={'a':a,'aligned':grid,'gps':np.ones(len(grid),bool),
                            'speed':a[:,2],'throttle':a[:,3], 'brake':np.zeros(len(grid),bool),
                            'dt':np.diff(a[:,1]),'official':12.,'drs_active':np.zeros(len(grid),bool)}
        return grid,selected

    def test_straight_core_uses_shared_distances_and_excludes_exit_advantage(self):
        grid,selected=self.core_fixture()
        # Faster corner exit on B must not overturn its slower settled speed.
        selected['B']['dt'][:40]*=.5
        result=straight_core_measurements(selected,[(0,200)],grid,selected['A'])
        self.assertAlmostEqual(result['A']['straight_core_time'],700*3.6/300)
        self.assertEqual(result['A']['straight_core_delta'],0)
        self.assertGreater(result['B']['straight_core_delta'],0)
        self.assertEqual(result['A']['straight_core_windows'],result['B']['straight_core_windows'])
        self.assertEqual(result['B']['straight_core_distance_m'],700)
        self.assertAlmostEqual(result['B']['straight_core_gap_s'],
                               result['B']['straight_core_delta']*12/100)

    def test_bad_fastest_reference_does_not_discard_other_laps(self):
        from performance_tracks import measure_field
        samples=[{'Distance':i*10.,'ElapsedSeconds':i*.9,'Speed':100.,
                  'Throttle':100,'Brake':0,'X':i*100.,'Y':0} for i in range(101)]
        selections=[{'team':t,'time':90.,'start':0.,'end':90.} for t in 'AB']
        attempts=[]
        def fake_align(item,reference,grid):
            attempts.append(reference['selection']['team'])
            if reference['selection']['team']=='A':
                raise ValueError('Unsuitable reference geometry')
            return {**item,'aligned':item['a'][:,0],'speed':np.full(len(grid),100.),
                    'throttle':np.full(len(grid),100.),'brake':np.zeros(len(grid),bool),
                    'scale':1.,'dt':np.full(len(grid)-1,90/(len(grid)-1))}
        with patch('performance_tracks.align',side_effect=fake_align):
            result=measure_field([(t,samples,None) for t in 'AB'],selections,[])
        self.assertIn('B',attempts)
        self.assertEqual(result['error'],'Too few reliable braking/corner zones')

    def test_acceleration_uses_selected_lap_and_rejects_native_gaps(self):
        from performance_tracks import analyze_straights_speed_domain
        grid=np.arange(0.,1005.,5.);selected={}
        for team,scale in [('A',1.),('B',1.1),('C',1.2)]:
            a=np.zeros((len(grid),8));a[:,0]=grid;a[:,2]=150+grid*.18
            a[:,1]=(a[:,2]-150)/50*scale;a[:,3]=100
            selected[team]={'a':a,'aligned':grid,'speed':a[:,2],
                            'throttle':a[:,3],'brake':np.zeros(len(grid),bool),
                            'dt':np.diff(a[:,1]),'official':10.,'selection':{'start':0}}
        candidates={'B':[selected['A']]}
        result=analyze_straights_speed_domain(selected,[(0,200)],grid,selected['A'],
                    np.zeros(200,bool),candidates)
        self.assertAlmostEqual(result['B']['accel_bands']['200_250']['gap_s'],.1)
        selected['B']['a'][90:,1]+=.8
        result=analyze_straights_speed_domain(selected,[(0,200)],grid,selected['A'],
                    np.zeros(200,bool),candidates)
        self.assertNotIn('200_250',result['B']['accel_bands'])

    def test_straight_core_rejects_full_throttle_bends(self):
        grid,selected=self.core_fixture()
        # A 200-m radius corner at 300 km/h is not a straight despite full throttle.
        for item in selected.values():
            item['a'][:,5]=2000*np.sin(grid/200)
            item['a'][:,6]=2000*(1-np.cos(grid/200))
        result=straight_core_measurements(selected,[(0,200)],grid,selected['A'])
        self.assertTrue(all(row['straight_core_time'] is None for row in result.values()))

    def test_straight_core_lift_brake_and_aero_mismatch_remove_shared_windows(self):
        grid,selected=self.core_fixture()
        selected['B']['throttle'][60:150]=80
        selected['C']['brake'][150:180]=True
        result=straight_core_measurements(selected,[(0,200)],grid,selected['A'])
        self.assertTrue(all(row['straight_core_time'] is None for row in result.values()))
        grid,selected=self.core_fixture()
        selected['B']['drs_active'][:]=True
        result=straight_core_measurements(selected,[(0,200)],grid,selected['A'])
        self.assertTrue(all(row['straight_core_delta'] is None for row in result.values()))

    def test_repeat_core_windows_are_fixed_not_redetected(self):
        grid,selected=self.core_fixture()
        baseline=straight_core_measurements(selected,[(0,200)],grid,selected['A'])
        windows=baseline['A']['straight_core_windows']
        repeated=straight_core_measurements(selected,[(0,200)],grid,selected['A'],windows)
        self.assertEqual(repeated['A']['straight_core_windows'],windows)
        selected['B']['throttle'][60:65]=80
        unsupported=straight_core_measurements(selected,[(0,200)],grid,selected['A'],windows)
        self.assertIsNone(unsupported['A']['straight_core_time'], 'do not silently shorten a frozen comparison window')

    def test_partial_acceleration_zone_coverage_retains_connected_teams(self):
        from performance_tracks import connected_zone_scores
        scores, counts, keys = connected_zone_scores({
            'one': {'A': 10., 'B': 11., 'C': 12.},
            'two': {'B': 21., 'C': 22., 'D': 23.},
            'isolated': {'E': 5., 'F': 6., 'G': 7.}})
        self.assertEqual(set(scores), set('ABCD'))
        for i, team in enumerate('ABCD'):
            self.assertAlmostEqual(scores[team], i, places=6)
        self.assertEqual(counts, {'A': 1, 'B': 2, 'C': 2, 'D': 1})
        self.assertEqual(set(keys), {'one', 'two'})

    def test_generic_retirement_does_not_inherit_unlinked_event_note(self):
        from performance import get_verified_retirement, classify_retirement
        self.assertIsNone(get_verified_retirement('Monaco Grand Prix', 'STR', 2026))
        result = classify_retirement('Retired', 'Monaco Grand Prix', 'STR', session_year=2026)
        self.assertEqual(result['category'], 'Unknown / unverified')

    def test_tyre_fit_removes_slow_mistake_without_erasing_real_degradation(self):
        rows = [lap(time=90+i*.15, lap=i+5, age=i+1) for i in range(20)]
        rows[9]['time'] += 4
        fit = fit_tyre_stint(rows)
        self.assertAlmostEqual(fit['raw_slope'], .15)
        self.assertAlmostEqual(fit['fuel_adjusted_slope'], .21)
        self.assertEqual(fit['outlier_laps'], 1)
        self.assertTrue(fit['supported'])
        self.assertEqual(fit['samples'], 19)

    def test_tyre_fit_keeps_short_run_diagnostic_and_rejects_corrupt_age(self):
        rows = [lap(time=90+i*.1, lap=i+5, age=i+1) for i in range(3)]
        self.assertFalse(fit_tyre_stint(rows)['supported'])
        rows[2]['age'] = 10
        self.assertIsNone(fit_tyre_stint(rows))

    def test_tyre_block_sensitivity_preserves_linear_trend_and_exposes_curve(self):
        linear = [lap(time=90+i*.1, lap=i+5, age=i+1) for i in range(24)]
        fit = fit_tyre_stint(linear)
        self.assertEqual(fit['block_sensitivity_raw'], [.1, .1])
        self.assertEqual(fit['block_sensitivity_fits'], 6)
        curved = [lap(time=90+.02*i+.12*max(0,i-12), lap=i+5, age=i+1) for i in range(26)]
        bounds = fit_tyre_stint(curved)['block_sensitivity_raw']
        self.assertGreater(bounds[1]-bounds[0], .02)
        short = fit_tyre_stint(linear[:8])
        self.assertIsNone(short['block_sensitivity_raw'])

    def test_tyre_fit_retains_late_stint_falloff(self):
        rows = [lap(time=90+.02*i+.12*max(0,i-12), lap=i+5, age=i+1)
                for i in range(26)]
        fit = fit_tyre_stint(rows)
        self.assertEqual(fit['outlier_laps'], 0)
        self.assertGreater(fit['late_slope'], fit['early_slope']+.1)

    def test_tyre_fit_splits_neutralisation_and_exposes_clean_air(self):
        rows = [lap('A', 'Alpha', time=90+i*.1, lap=i+3, age=i+1,
                    track='4' if i==10 else '1') for i in range(23)]
        clear = {(r['driver'], r['lap']): .5 if r['lap']==7 else 10.0 for r in rows}
        with patch('performance.records', return_value=rows), patch('performance.traffic_gaps', return_value=clear):
            result = analyze(RaceSession())
        runs = result['teams'][0]['tyre_age_stints']
        self.assertEqual(len(runs), 2)
        self.assertLess(runs[0]['max_age'], runs[1]['min_age'])
        self.assertEqual(runs[0]['samples']-runs[0]['clean_air']['samples'], 1)
        self.assertAlmostEqual(runs[0]['clean_air']['raw_slope'], .1)

    def test_braking_compares_same_speed_drop_from_original_time(self):
        grid = np.arange(0., 405., 5.)
        selected = {}
        for team, rate in [('A', 100.), ('B', 80.), ('C', 100.)]:
            t = np.arange(0., 2.01, .1)
            v = 310 - rate*t
            a = np.zeros((len(t), 8))
            a[:, 1], a[:, 2], a[:, 4] = t, v, 1
            selected[team] = {'a': a, 'aligned': np.linspace(0, 390, len(t))}
        windows = {'Z1': (0, 80, dict.fromkeys(selected, 0), 'straight')}
        result = matched_braking_measurements(selected, windows, grid)
        a, b, c = [result[t][0] for t in 'ABC']
        self.assertEqual(a['entry_speed'], b['entry_speed'])
        self.assertEqual(a['exit_speed'], b['exit_speed'])
        self.assertAlmostEqual(b['duration']/a['duration'], 1.25)
        self.assertAlmostEqual(a['duration'], c['duration'])
        self.assertAlmostEqual(a['mean_g']/b['mean_g'], 1.25)
        self.assertAlmostEqual(a['distance'], (a['entry_speed']+a['exit_speed'])/7.2*a['duration'])
        windows['Z1'] = (0, 80, dict.fromkeys(selected, 0), 'mixed approach')
        self.assertTrue(all(not v for v in matched_braking_measurements(selected, windows, grid).values()))

    def test_braking_uses_only_selected_fastest_lap_not_repeat_average(self):
        grid = np.arange(0., 405., 5.)
        def item(rate):
            t = np.linspace(0., 250/rate, 26)
            a = np.zeros((len(t), 8))
            a[:, 1], a[:, 2], a[:, 4] = t, 310-rate*t, 1
            return {'a': a, 'aligned': np.linspace(0, 390, len(t)),
                    'selection': {'driver': 'VER','compound':'SOFT','phase':'Q3'}}
        selected = {team: item(100.) for team in 'ABC'}
        windows = {'Z1': (0, 78, dict.fromkeys(selected, 0), 'straight')}
        one = matched_braking_measurements(selected, windows, grid)
        candidates = {team: [selected[team], item(90. if team == 'A' else 100.)]
                      for team in 'ABC'}
        repeated = matched_braking_measurements(selected, windows, grid, candidates)
        self.assertEqual(repeated['A'][0]['source_laps'], 1)
        self.assertEqual(repeated['A'][0]['sample_count'], one['A'][0]['sample_count'])
        self.assertEqual(repeated['A'][0]['duration'], repeated['B'][0]['duration'])
        self.assertEqual(repeated['A'][0]['quality'], 'supported')
        self.assertIsNone(repeated['A'][0]['repeat_spread_s'])
        self.assertEqual(repeated['A'][0]['source_selection'], selected['A']['selection'])
        self.assertAlmostEqual(repeated['A'][0]['approach_time'], 2.5)

    def test_stronger_well_sampled_braking_is_not_censored(self):
        grid=np.arange(0.,405.,5.)
        durations=[]
        for g in (4.,5.):
            t=np.linspace(0,55/(g*9.80665*3.6),6)
            a=np.zeros((len(t),8));a[:,1]=t;a[:,2]=250-g*9.80665*3.6*t;a[:,4]=1
            selected={team:{'a':a.copy(),'aligned':np.linspace(0,35,len(t))} for team in 'ABC'}
            result=matched_braking_measurements(selected,{'Z':(0,7,dict.fromkeys(selected,0),'straight')},grid)
            z=result['A'][0]
            self.assertAlmostEqual(z['mean_g'],g)
            self.assertEqual(z['quality'],'supported')
            durations.append(z['duration'])
        self.assertLess(durations[1],.3)
        self.assertLess(durations[1],durations[0])

    def test_sparse_repeats_remain_provisional(self):
        grid=np.arange(0.,405.,5.)
        t=np.array([0.,.24,.48]);a=np.zeros((3,8));a[:,1]=t;a[:,2]=[260,230,190];a[:,4]=1
        item={'a':a,'aligned':np.array([0.,20.,40.]),'selection':{'driver':'VER','compound':'SOFT','phase':'Q3'}}
        selected={team:item for team in 'ABC'}
        result=matched_braking_measurements(selected,{'Z':(0,8,dict.fromkeys(selected,0),'straight')},grid,
                                            {team:[item,item,item] for team in selected})
        self.assertEqual(result['A'][0]['source_laps'],1)
        self.assertEqual(result['A'][0]['quality'],'provisional')
        self.assertEqual(result['A'][0]['min_native_interior_samples'],1)

    def test_braking_repeats_match_compound_and_qualifying_phase(self):
        grid=np.arange(0.,405.,5.);t=np.linspace(0,2,21)
        a=np.zeros((len(t),8));a[:,1]=t;a[:,2]=310-100*t;a[:,4]=1
        main={'a':a,'aligned':np.linspace(0,390,len(t)),
              'selection':{'driver':'VER','compound':'SOFT','phase':'Q3'}}
        other={**main,'selection':{'driver':'VER','compound':'MEDIUM','phase':'Q2'}}
        selected={team:main for team in 'ABC'}
        result=matched_braking_measurements(selected,{'Z':(0,78,dict.fromkeys(selected,0),'straight')},grid,
                                            {team:[main,other] for team in selected})
        self.assertEqual(result['A'][0]['source_laps'],1)

    def test_approach_rejects_unfair_boundary_speeds_and_ignores_lap_scale(self):
        grid=np.arange(0.,105.,5.);selected={}
        for team,offset in [('A',0),('B',0),('C',0),('D',30),('E',-30)]:
            a=np.zeros((11,8));a[:,1]=np.linspace(0,1,11);a[:,2]=np.linspace(280,160,11)
            if team=='D':a[:,2]+=offset
            if team=='E':a[:,2]+=np.linspace(0,offset,11)
            selected[team]={'a':a,'aligned':np.linspace(0,100,11),'dt':np.ones(20)*100}
        result=braking_approach_measurements(selected,0,20,grid)
        self.assertEqual(set(result),set('ABC'))
        self.assertAlmostEqual(result['A']['approach_time'],1)

    def test_braking_rejects_missing_samples_and_legacy_short_intervals(self):
        grid = np.arange(0., 405., 5.)
        t = np.array([0., .1, .2, 1., 1.1, 1.2])
        a = np.zeros((len(t), 8))
        a[:, 1], a[:, 2], a[:, 4] = t, 310-100*t, 1
        selected = {team: {'a': a.copy(), 'aligned': np.linspace(0, 390, len(t))} for team in 'ABC'}
        windows = {'Z1': (0, 80, dict.fromkeys(selected, 0), 'straight')}
        self.assertTrue(all(not v for v in matched_braking_measurements(selected, windows, grid).values()))

    def test_braking_zones_are_detected_without_corner_markers(self):
        grid = np.arange(0.0, 2005.0, 5.0)
        speed = np.full(len(grid), 300.0)
        brake = np.zeros(len(grid), dtype=bool)
        for start in (400, 1200):
            brake[(grid >= start) & (grid < start + 125)] = True
            speed[(grid >= start) & (grid < start + 180)] = np.linspace(
                300, 110, np.count_nonzero((grid >= start) & (grid < start + 180)))
        selected = {}
        for team, offset in (('A', -25), ('B', 0), ('C', 25)):
            team_brake = np.zeros(len(grid), dtype=bool)
            for start in (400, 1200):
                team_brake[(grid >= start + offset) & (grid < start + offset + 125)] = True
            selected[team] = {'brake': team_brake, 'speed': speed}
        zones = observed_braking_zones(selected, grid)
        self.assertEqual(len(zones), 2)
        self.assertEqual([zone['corner'] for zone in zones], ['Brake zone 1', 'Brake zone 2'])

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
        start, turn_in, onsets, mode = windows['T1']
        self.assertLessEqual(grid[start], 505)
        self.assertGreaterEqual(grid[turn_in], 575)
        self.assertLessEqual(grid[turn_in], 625)
        self.assertEqual(len(onsets), 3)
        self.assertEqual(mode, 'straight')

    def test_straight_braking_uses_release_when_heading_stays_straight(self):
        grid = np.arange(0.0, 1005.0, 5.0)
        a = np.zeros((len(grid), 8))
        a[:, 5] = grid
        item = {'a': a, 'gps': np.ones(len(grid), dtype=bool), 'aligned': grid,
                'brake': (grid >= 500) & (grid < 650),
                'speed': 300 - np.clip(grid - 500, 0, 180)}
        zones = [{'start': 90, 'apex': 150, 'corner': 'Brake zone 1'}]
        windows = straight_braking_windows({'A': item, 'B': item, 'C': item}, item, grid, zones)
        self.assertIn('Brake zone 1', windows)
        self.assertLessEqual(grid[windows['Brake zone 1'][1]], 660)
        self.assertEqual(windows['Brake zone 1'][3], 'straight')

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

