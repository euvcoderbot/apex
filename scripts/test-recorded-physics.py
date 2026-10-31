"""Offline public-model regression checks; not validation of car capability.

Recorded lap metadata is an independent duration reference. Public channels
cannot establish fuel, tyre condition, aero load or ground-truth grip.
"""
import gzip
import hashlib
import json
import math
from pathlib import Path
import sys
import unittest
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from car_physics import speed_domain_metrics,_speed_trace_time,_reference_lap


class RecordedPhysicsTests(unittest.TestCase):
    def test_reference_uses_official_time_then_first_completion(self):
        a=np.zeros((2,8));a[-1,1]=89.
        b=np.zeros((2,8));b[-1,1]=88.
        laps={'NOR':[a],'LEC':[b]}
        timing={id(a):{'official_time_s':91.824,'completed_at_s':2000.,'driver':'NOR','lap':18},
                id(b):{'official_time_s':92.019,'completed_at_s':1000.,'driver':'LEC','lap':20}}
        selected,info=_reference_lap(laps,timing)
        self.assertIs(selected,a);self.assertEqual(info['basis'],'official-lap-time')
        timing[id(b)]['official_time_s']=91.824
        selected,info=_reference_lap(laps,timing)
        self.assertIs(selected,b);self.assertEqual(info['tie_break'],'earliest-completion')
        timing[id(b)]['completed_at_s']=None
        first,info=_reference_lap(laps,timing)
        second,_=_reference_lap(dict(reversed(list(laps.items()))),timing)
        self.assertIs(first,second)
        self.assertEqual(info['tie_break'],'stable-identity-chronology-unavailable')

    def test_production_adapter_preserves_official_timing_and_completion_clock(self):
        from performance_tracks import _speed_domain_inputs
        a=np.zeros((2,8))
        cars,timing=_speed_domain_inputs({'McLaren':[{'a':a,'official':91.824,
            'selection':{'end':2000.,'driver':'NOR','lap':18}}]})
        self.assertIs(cars['McLaren'][0],a)
        self.assertEqual(timing['McLaren'][0],{'official_time_s':91.824,'completed_at_s':2000.,'driver':'NOR','lap':18})

    def test_integral_has_correct_units_and_matches_constant_acceleration(self):
        for acceleration in (-6.,0.,3.):
            distance=np.array([0.,7.,45.,100.])
            speed=np.sqrt(40.**2+2*acceleration*distance)
            samples=np.zeros((4,8));samples[:,2]=speed*3.6
            for lo,hi in ((0.,100.),(12.,83.)):
                start=np.sqrt(40.**2+2*acceleration*lo)
                finish=np.sqrt(40.**2+2*acceleration*hi)
                expected=(hi-lo)/40. if acceleration==0 else (finish-start)/acceleration
                self.assertAlmostEqual(_speed_trace_time(distance,samples,lo,hi),expected,places=11)

    def test_recorded_sessions_are_finite_deterministic_and_order_independent(self):
        files=sorted((ROOT/'data/val').glob('*.json.gz'))
        self.assertGreaterEqual(len(files),20)
        gaps=[];total=0;ranked=0;digest=hashlib.sha256();differences=[]
        def equivalent(left,right,path='root'):
            if isinstance(left,dict):
                self.assertEqual(set(left),set(right),path)
                for key in left:equivalent(left[key],right[key],path+'.'+str(key))
            elif isinstance(left,list):
                self.assertEqual(len(left),len(right),path)
                for i,(a,b) in enumerate(zip(left,right)):equivalent(a,b,path+f'[{i}]')
            elif isinstance(left,float):
                differences.append(abs(left-right))
                self.assertTrue(math.isclose(left,right,rel_tol=1e-10,abs_tol=1e-10),f'{path}: {left} != {right}')
            else:self.assertEqual(left,right,path)
        for file in files:
            packed=file.read_bytes();digest.update(packed)
            data=json.loads(gzip.decompress(packed));cars={};timing={}
            for lap in sorted(data['laps'],key=lambda row:row['time']):
                channels=lap['samples']
                a=np.column_stack([channels[key] for key in ('d','t','v','thr','brk','x','y','drs')]).astype(float)
                total+=1;gaps.append(abs(float(a[-1,1]-a[0,1])-lap['time']))
                if lap['driver'] not in cars:
                    cars[lap['driver']]=[a]
                    # This corpus has official times, but no absolute session
                    # completion clock. Do not invent chronology from lap numbers.
                    timing[lap['driver']]=[{'official_time_s':lap['time'],'driver':lap['driver'],'lap':lap['lap']}]
            with self.subTest(file=file.name):
                result=speed_domain_metrics(cars,lap_info=timing)
                json.dumps(result,sort_keys=True,allow_nan=False)
                reversed_result=speed_domain_metrics(dict(reversed(list(cars.items()))),lap_info=timing)
                json.dumps(reversed_result,allow_nan=False)
                equivalent(result,reversed_result)
                if file.name=='2026-Madrid.json.gz':self.assertEqual(result['reference']['car'],'NOR')
                ranked+=len(result.get('cars',{}))
                # An unsupported field must explain absence, not manufacture zeros.
                if not result.get('cars'):self.assertTrue(result.get('error'))
        print(json.dumps({'recorded_sessions':len(files),'laps':total,'ranked_driver_observations':ranked,
            'corpus_sha256':digest.hexdigest(),'maximum_order_difference':max(differences,default=0.),
            'absolute_official_duration_vs_packet_span_s':{
                'median':float(np.median(gaps)),'p95':float(np.percentile(gaps,95)),'max':max(gaps)},
            'limitation':'Packet endpoints are not official timing lines; this is a diagnostic, not an alignment correction.'}))

    def test_missing_position_is_an_explicit_unavailable_result(self):
        file=ROOT/'data/val/2026-Austin.json.gz'
        data=json.loads(gzip.decompress(file.read_bytes()));cars={}
        for lap in data['laps']:
            s=lap['samples'];a=np.column_stack([s[key] for key in ('d','t','v','thr','brk','x','y','drs')]).astype(float)
            a[:,5:7]=np.nan;cars.setdefault(lap['driver'],[a])
        result=speed_domain_metrics(cars)
        self.assertFalse(result['cars']);self.assertIn('position',result['error'])
        json.dumps(result,allow_nan=False)


if __name__=='__main__':unittest.main()
