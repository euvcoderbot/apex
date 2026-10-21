"""Known-truth, source-provenance and local-eligibility regressions."""
import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from performance import race_estimates,recover_race_estimates,fit_tyre_stint
from pace_models import tyre_curve,qualifying_conditions
from telemetry_sources import fuse_native_samples
from performance_tracks import source_intervals,prepare,speed_crossing_bounds
import numpy as np


class MethodologyTests(unittest.TestCase):
    def recovery_fixture(self, traffic=False):
        rows, gaps = [], {}
        for k, driver in enumerate('ABCD'):
            for i in range(3, 24 if driver != 'D' else 10):
                gap = .4+(i%4)*.2 if driver == 'D' and traffic else 2.8
                if traffic and driver != 'D' and (i+k)%3 == 0:
                    gap = .6+(k%2)*.3
                # Known driver effect and a common traffic penalty in log time.
                value = 90*np.exp((k*.3-i*.02+max(0,2-gap)*.2)/100)
                rows.append(dict(driver=driver,lap=i,age=i,compound='MEDIUM',stint=1,time=value))
                gaps[driver,i] = gap
        clear = [r for r in rows if gaps[r['driver'],r['lap']] > 2]
        base, support = race_estimates(clear, False)
        return rows, gaps, base, support

    def test_sparse_clean_laps_recover_a_contrast_without_moving_standard_drivers(self):
        rows, gaps, base, support = self.recovery_fixture()
        fitted, detail, basis = recover_race_estimates(rows, gaps, base, support)
        self.assertEqual(set(base), set('ABC'))
        for d in base:self.assertEqual(base[d], fitted[d])
        self.assertEqual(basis['D'], 'sparse-clear-air')
        self.assertTrue(detail['D']['provisional'])
        self.assertAlmostEqual(fitted['D'], np.expm1(.009)*100, 5)

    def test_traffic_recovery_identifies_known_effect_and_flags_extrapolation(self):
        rows, gaps, base, support = self.recovery_fixture(True)
        fitted, detail, basis = recover_race_estimates(rows, gaps, base, support)
        self.assertEqual(basis['D'], 'traffic-adjusted')
        self.assertTrue(detail['D']['clear_air_extrapolation'])
        self.assertAlmostEqual(fitted['D'], np.expm1(.009)*100, 4)
        for d in base:self.assertEqual(base[d], fitted[d])
        # Unknown proximity is not replaced with assumed clean air.
        unknown = {key: value for key,value in gaps.items() if key[0] != 'D'}
        self.assertNotIn('D', recover_race_estimates(rows, unknown, base, support)[0])

    def test_infeasible_braking_assumption_does_not_produce_reversed_bounds(self):
        self.assertIsNone(speed_crossing_bounds(np.array([0.,.1]),np.array([300.,100.]),200))
        lo,hi=speed_crossing_bounds(np.array([0.,1.]),np.array([300.,100.]),200)
        self.assertLessEqual(lo,hi)
        self.assertIsNone(speed_crossing_bounds(np.array([0.,1.]),np.array([300.,250.]),200))

    def test_a_frozen_patch_excludes_its_intervals_not_other_native_evidence(self):
        from performance_tracks import frozen
        a=np.zeros((501,8));a[:,0]=np.arange(501)*10.;a[:,1]=np.arange(501)*.2
        a[:,2]=200+np.arange(501)*.01;a[:,3]=100;a[:,5]=a[:,0]*10
        a[100:110,2]=250;a[100:110,4]=1
        field={'grid':a[:,0],'speed':np.linspace(320,100,501)}
        field['speed'][100:110]=np.linspace(320,200,10)
        item={'a':a,'aligned':a[:,0]}
        self.assertTrue(frozen(item,field))
        self.assertFalse(frozen(item,field,allow_local=True))
        self.assertGreater(sum(item['frozen_bad_intervals']),0)
        intervals=source_intervals(item)
        self.assertGreater(intervals[102],1.5);self.assertLess(intervals[300],.6)

    def test_disconnected_driver_does_not_erase_identifiable_race_group(self):
        rows=[dict(driver=d,lap=i,age=i,compound='MEDIUM',stint=1,time=90+.02*i+.2*k) for k,d in enumerate('ABC') for i in range(3,23)]
        before,_=race_estimates(rows,False)
        rows += [dict(driver='D',lap=i,age=i-38,compound='MEDIUM',stint=2,time=91+.02*i) for i in range(41,61)]
        after,support=race_estimates(rows,False)
        self.assertEqual(set(after),set('ABC'))
        for d in before:self.assertAlmostEqual(before[d],after[d],7)
        self.assertFalse(support['D']['identifiable'])

    def test_genuine_late_falloff_is_retained_not_deleted_as_an_outlier(self):
        rows=[dict(lap=i,age=i,time=90+.03*i+max(0,i-20)*.5) for i in range(1,31)]
        fit=fit_tyre_stint(rows)
        self.assertEqual(fit['samples'],30)
        self.assertEqual(fit['nonlinear']['change_age'],20)
        self.assertAlmostEqual(fit['nonlinear']['steady_slope'],.03,6)
        self.assertAlmostEqual(fit['nonlinear']['late_slope'],.53,6)
        self.assertEqual(fit['nonlinear']['range'],[1,30])

    def test_warmup_curve_does_not_turn_into_negative_steady_degradation(self):
        rows=[dict(lap=i,age=i,time=90+.04*i+.4*max(0,4-i)) for i in range(1,25)]
        curve=tyre_curve(rows)
        self.assertTrue(curve['warmup_modelled'])
        self.assertAlmostEqual(curve['steady_slope'],.04,6)
        self.assertLess(curve['warmup_slope'],0)

    def sample(self,t,speed=250,**extra):
        return dict(Timestamp=1000+t,ElapsedSeconds=t,Speed=speed,Distance=t*250/3.6,Throttle=100,Brake=False,DRS=0,RPM=10000,nGear=8,X=t,Y=0,**extra)

    def test_duplicate_source_packets_are_one_observation_and_conflicts_not_averaged(self):
        primary=[self.sample(t) for t in (0,.25,.5,.75,1)]
        secondary=[dict(r) for r in primary];secondary[2]['Speed']=280
        result,report=fuse_native_samples(primary,secondary)
        self.assertEqual(len(result),len(primary));self.assertEqual(report['duplicate_packets'],5)
        self.assertGreater(report['conflicts'],0);self.assertEqual(result[2]['Speed'],250)
        self.assertNotIn('ChannelSources',primary[0])

    def test_only_verified_missing_native_packets_are_added(self):
        primary=[self.sample(t) for t in (0,.25,1.25,1.5)]
        secondary=[self.sample(t) for t in (0,.25,.5,.75,1,1.25,1.5)]
        result,report=fuse_native_samples(primary,secondary)
        self.assertEqual(report['added_packets'],3);self.assertEqual(len(result),7)
        self.assertEqual([r['ElapsedSeconds'] for r in result],[r['ElapsedSeconds'] for r in secondary])
        self.assertAlmostEqual(result[-1]['Distance'],1.5*250/3.6)
        secondary=[dict(r,Timestamp=r['Timestamp']+.1) for r in secondary]
        refused,report=fuse_native_samples(primary,secondary)
        self.assertEqual(len(refused),len(primary));self.assertEqual(report['status'],'different-lap-origin')

    def test_secondary_fills_only_missing_channels_without_counting_a_new_packet(self):
        primary=[self.sample(0),self.sample(.25)];primary[1]['X']=None
        result,report=fuse_native_samples(primary,[self.sample(.25)])
        self.assertEqual(len(result),2);self.assertEqual(report['filled_channels'],1)
        self.assertEqual(result[1]['ChannelSources']['X'],'OpenF1:position-joined')

    def test_bad_packet_is_local_not_a_synthetic_speed_repair(self):
        rows=[self.sample(i*.25) for i in range(321)];rows[100]['Speed']=400
        result=prepare(rows,{'time':80},False)
        self.assertEqual(result['removed_speed_samples'],1);self.assertTrue(max(source_intervals(result))>1.5)
        self.assertEqual(max(result['a'][:,2]),250)

    def test_timestamp_condition_diagnostic_recovers_known_slope(self):
        rows=[];selections={}
        for d in range(10):
            own=[]
            for end in (1000+d*2,1600+d*2,2200+d*2):
                r=dict(driver='D'+str(d),time=90+d*.1-.0003*(end-1000),end=end,fresh=True,age=2,pit=False,rain=False,accurate=True,track='1',deleted=False,compound='SOFT')
                own.append(r);rows.append(r)
            selections['T'+str(d)]=own[-1]
        fit=qualifying_conditions(rows,selections)
        self.assertEqual(fit['status'],'estimated');self.assertAlmostEqual(fit['seconds_per_minute'],-.018,7)
        sparse=qualifying_conditions(rows[:10],selections)
        self.assertEqual(sparse['status'],'unsupported');self.assertEqual(sparse['estimates'],{})

if __name__=='__main__':unittest.main()
