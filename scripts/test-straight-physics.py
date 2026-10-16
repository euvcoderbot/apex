import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import numpy as np
from performance_tracks import straight_core_measurements

class StraightPhysicsTests(unittest.TestCase):
    def test_gps_clock_compression_cannot_make_a_slower_speed_the_winner(self):
        grid=np.arange(0.,1005.,5.)
        selected={}
        for name,speed,clock_speed in [('A',300.,300.),('B',290.,330.),('C',280.,280.)]:
            a=np.zeros((len(grid),8));a[:,0]=grid;a[:,1]=grid*3.6/speed;a[:,2]=speed;a[:,3]=100;a[:,5]=grid*10
            selected[name]={'a':a,'gps':np.ones(len(a),bool),'aligned':grid,'speed':a[:,2],'throttle':a[:,3],'brake':np.zeros(len(grid),bool),'dt':np.diff(grid)*3.6/clock_speed,'official':12.,'drs_active':np.zeros(len(grid),bool)}
        result=straight_core_measurements(selected,[(0,200)],grid,selected['A'])
        self.assertLess(result['B']['straight_core_observed_time'],result['A']['straight_core_observed_time'])
        self.assertGreater(result['B']['straight_core_time'],result['A']['straight_core_time'])
        self.assertEqual(result['A']['straight_core_gap_s'],0)
        self.assertEqual(result['B']['straight_core_time_basis'],'estimated-equal-distance-from-native-speed')
        self.assertAlmostEqual(result['B']['straight_core_distance_m']/result['B']['straight_core_time']*3.6,290.)
        self.assertEqual(result['A']['straight_core_windows'],result['B']['straight_core_windows'])
if __name__=='__main__':unittest.main()
