"""Analytical boundaries and exact-output optimization checks."""
import sys
from pathlib import Path
import unittest
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import car_physics as p

class PhysicsBoundaries(unittest.TestCase):
    def test_straight_integrates_partial_steps(self):
        nodes=np.array([100.,200.,300.]);curve=np.zeros(3)
        for distance in (0.,1.,2.,100.,101.,101.25):
            duration,speed,_=p.simulate_straight(nodes,curve,180.,distance,curve)
            self.assertAlmostEqual(duration,distance/50.,places=11)
            self.assertEqual(speed,180.)
        for distance,step in ((-1.,2.),(10.,0.),(float('nan'),2.)):
            with self.assertRaises(ValueError):p.simulate_straight(nodes,curve,180.,distance,curve,step)

    def test_drs_has_three_states_and_never_labels_unknown_closed(self):
        for code,expected in [(0.,'drs_closed'),(1.,'drs_closed'),(8.,'drs_closed'),(10.,'drs_open'),(12.,'drs_open'),(14.,'drs_open'),(11.,'aero_unknown'),(np.nan,'aero_unknown')]:
            a=np.zeros((10,8));a[:,p.T]=np.arange(10)*.25;a[:,p.V]=200;a[:,p.THR]=100;a[:,p.DRS]=code
            signals=p.lap_signals(a,None)
            for state in ('drs_open','drs_closed','aero_unknown'):
                self.assertEqual(bool(signals[state][4]),state==expected,(code,state))

    def test_reused_minima_produce_identical_apex_measurements(self):
        a=np.zeros((100,8));a[:,p.T]=np.arange(100)*.25;a[:,p.D]=np.arange(100)*4
        a[:,p.V]=200-90*np.exp(-((a[:,p.D]-200)/40)**2)
        corner={'start_m':120.,'end_m':280.,'apex_m':200.,'band':'low'}
        self.assertEqual(p.car_apex(a,a[:,p.D],corner),p.car_apex(a,a[:,p.D],corner,p.speed_minima(a)))

if __name__=='__main__':unittest.main()
