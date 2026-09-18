"""Small deterministic checks for the performance calculations."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import unittest
from unittest.mock import patch
from performance import analyze, clean, slope, traffic_gaps, telemetry_metrics


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
        return {'Abbreviation':code,'TeamName':'Alpha' if code in ('A','B') else 'Beta',
                'TeamColor':'888888','Q1':{'A':90,'B':91,'C':92}[code]}


class PerformanceTests(unittest.TestCase):
    def test_fastest_teammate_and_phase(self):
        rows=[lap(),lap('B',time=91),lap('C','Beta',92),lap('A',time=80,phase='Q2')]
        with patch('performance.records',return_value=rows):
            result=analyze(Session())
        a,b=result['teams']
        self.assertEqual(a['lap']['driver'],'A')
        self.assertAlmostEqual(a['pace'],0)
        self.assertAlmostEqual(b['pace'],(92/90-1)*100)

    def test_unofficial_deleted_fast_lap_not_selected(self):
        with patch('performance.records',return_value=[lap(time=80),lap()]):
            result=analyze(Session())
        self.assertEqual(result['teams'][0]['lap']['time'],90)

    def test_wet_unknown_weather_and_flags_excluded(self):
        self.assertTrue(clean(lap()))
        for changes in ({'rain':None},{'rain':True},{'track':'14'},{'pit':True},{'deleted':True},{'compound':'INTERMEDIATE'}):
            self.assertFalse(clean(lap(**changes)))

    def test_traffic_gap_includes_lapped_car(self):
        rows=[lap('B',lap=2,end=399),lap('B',lap=3,end=489),lap()]
        self.assertEqual(traffic_gaps(rows)[('A',5)],1)

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


if __name__=='__main__':
    unittest.main()
