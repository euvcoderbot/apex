"""Known-truth tests for speed-domain car metrics (car_physics.py).

Laps come from a point-mass lap simulator with downforce, so each car's grip,
power and braking are known. The key regressions are cross-contamination:
more grip must not look like straight-line speed (higher corner exit speed),
and more power must not look like cornering ability.
"""
import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
from car_physics import speed_domain_metrics

G = 9.80665
# (length m, curvature 1/m). Apex speeds span the low/medium/high bands.
TRACK = [(700, 0), (45, 1/25), (450, 0), (80, 1/90), (380, 0), (110, 1/130), (600, 0), (50, 1/35),
         (420, 0), (90, 1/110), (500, 0), (130, 1/150), (550, 0)]


def simulate(mu=1., power=940., drag=.0011, brake=1., downforce=5e-4, rng=None, offset_m=0.):
    ds = 1.
    kappa = np.concatenate([np.full(int(length/ds), k) for length, k in TRACK])
    n = len(kappa)
    k2 = np.r_[kappa, kappa]  # two laps: the second is in periodic steady state
    with np.errstate(divide='ignore'):
        limit = np.where(k2 > mu*G*downforce, np.sqrt(mu*G/np.maximum(k2-mu*G*downforce, 1e-12)), 1e3)
    forward = np.empty_like(limit); forward[0] = 50.
    for i in range(1, len(k2)):
        v = forward[i-1]
        a = min(power/v-drag*v*v, mu*G*(1+downforce*v*v))
        forward[i] = min(limit[i], np.sqrt(max(v*v+2*a*ds, 1.)))
    backward = np.empty_like(limit); backward[-1] = forward[-1]
    for i in range(len(k2)-2, -1, -1):
        v = backward[i+1]
        d = brake*G*(1+downforce*v*v)+drag*v*v
        backward[i] = min(forward[i], np.sqrt(v*v+2*d*ds))
    v = backward[n:]
    braking = backward[n:] < forward[n:]-1e-9
    full = ~braking & (np.abs(forward[n:]-v) < 1e-9) & (limit[n:] > v+.5)
    s = np.arange(n)*ds
    t = np.r_[0, np.cumsum(ds/((v[1:]+v[:-1])/2))]
    heading = np.cumsum(kappa)*ds
    x, y = np.cumsum(np.cos(heading))*ds*10, np.cumsum(np.sin(heading))*ds*10  # decimetres
    rng = rng or np.random.default_rng(0)
    # Each lap samples at its own phase, as real ~4 Hz telemetry does.
    grid = np.arange(rng.uniform(0, .27), t[-1], .27)
    times = grid+rng.uniform(0, .03, len(grid))
    times = np.sort(np.clip(times, 0, t[-1]))
    i = np.clip(np.searchsorted(t, times), 0, n-1)
    speed = np.round(np.interp(times, t, v)*3.6)
    return np.column_stack([np.interp(times, t, s)+offset_m, times, speed, np.where(full[i], 100., 40.),
                            braking[i].astype(float), np.interp(times, t, x), np.interp(times, t, y), np.zeros(len(times))])


def field(**special):
    cars = {f'base{k}': [simulate(rng=np.random.default_rng(k))] for k in range(3)}
    for name, params in special.items():
        cars[name] = [simulate(rng=np.random.default_rng(len(cars)+7), **params)]
    return speed_domain_metrics(cars)


def index(result, car, key):
    return result['cars'][car][key]['index']


def corner(result, car, band):
    return result['cars'][car]['cornering'][band]['index']


class SpeedDomainTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.r = field(grip={'mu': 1.03}, power={'power': 990.}, brakes={'brake': 1.08})

    def test_finds_corners_in_every_band(self):
        bands = {c['band'] for c in self.r['cars']['base0']['corners']}
        self.assertEqual(bands, {'low', 'medium', 'high'})

    def test_more_grip_shows_as_cornering_in_every_band(self):
        for band in ('low', 'medium', 'high'):
            # Apex-speed ratio: +3% grip is roughly +1.5-3% apex speed (more with downforce).
            self.assertGreater(corner(self.r, 'grip', band), 1.012, band)
            self.assertEqual(self.r['cars']['grip']['cornering'][band]['gap_s'], 0.)

    def test_more_grip_is_not_mistaken_for_straight_line_speed(self):
        # The grip car exits every corner faster. Window timing credits that
        # to the straight; equal-speed comparison must not.
        base = np.mean([index(self.r, f'base{k}', 'straight') for k in range(3)])
        self.assertAlmostEqual(index(self.r, 'grip', 'straight'), base, delta=.006)

    def test_more_power_shows_as_straight_line_not_cornering(self):
        # +5% power is ~1% less time over the same straight.
        self.assertLess(index(self.r, 'power', 'straight'), .995)
        self.assertEqual(self.r['cars']['power']['straight']['gap_pct'], 0.)
        for band in ('low', 'medium', 'high'):
            self.assertAlmostEqual(corner(self.r, 'power', band), 1., delta=.006, msg=band)

    def test_better_brakes_show_as_shorter_braking_only(self):
        self.assertLess(index(self.r, 'brakes', 'braking'), .96)
        self.assertEqual(self.r['cars']['brakes']['braking']['gap_pct'], 0.)
        self.assertAlmostEqual(corner(self.r, 'brakes', 'medium'), 1., delta=.006)

    def test_more_grip_is_not_mistaken_for_better_braking(self):
        # A higher apex speed changes the speed range braked through; the
        # comparison is made at equal speed, so it must not move braking.
        self.assertAlmostEqual(index(self.r, 'grip', 'braking'), 1., delta=.03)

    def test_distance_registration_error_does_not_move_cornering(self):
        shifted = speed_domain_metrics({**{f'base{k}': [simulate(rng=np.random.default_rng(k))] for k in range(3)},
                                        'late': [simulate(rng=np.random.default_rng(9), offset_m=12.)]})
        for band in ('low', 'medium', 'high'):
            self.assertAlmostEqual(corner(shifted, 'late', band), 1., delta=.008, msg=band)

    def test_a_lap_too_slow_to_be_a_flying_lap_is_not_measured(self):
        slow = simulate(rng=np.random.default_rng(5), power=500.)  # >3% off the fastest lap
        r = speed_domain_metrics({**{f'base{k}': [simulate(rng=np.random.default_rng(k))] for k in range(3)}, 'slow': [slow]})
        self.assertNotIn('slow', r['cars'])

    def test_missing_range_is_unranked_not_zero(self):
        lap = simulate(rng=np.random.default_rng(6))
        capped = lap[lap[:, 2] < 250]  # telemetry never shows the top-end range
        r = speed_domain_metrics({**{f'base{k}': [simulate(rng=np.random.default_rng(k))] for k in range(3)}, 'capped': [capped]})
        top = r['cars'].get('capped', {}).get('straight_top')
        self.assertTrue(top is None or top['index'] is None)

    def test_too_few_cars(self):
        self.assertIn('error', speed_domain_metrics({'a': [simulate()], 'b': [simulate()]}))


class MappedFastCornerTests(unittest.TestCase):
    def test_two_curved_fast_turns_remain_separate_without_speed_dips(self):
        from car_physics import field_segments, car_apex
        grid = np.arange(0., 1005., 5.)
        curvature = np.zeros(len(grid))
        curvature[(grid >= 220)&(grid <= 380)] = .004
        curvature[(grid >= 470)&(grid <= 630)] = -.004
        track = dict(grid=grid,x=grid,y=np.zeros(len(grid)),curvature=curvature,scale=1.)
        a = np.zeros((len(grid),8));a[:,0]=grid;a[:,1]=grid/(240/3.6);a[:,2]=240;a[:,3]=100
        segments = field_segments([(a,grid)]*3, track, [('5',300.,0.),('6',550.,0.)])
        bends = [c for c in segments['corners'] if c.get('mapped_fast_bend')]
        self.assertEqual([c['turn'] for c in bends], ['5','6'])
        self.assertLess(bends[0]['end_m'], bends[1]['start_m'])
        for c in bends:
            apex = car_apex(a,grid,c)
            self.assertEqual(apex['method'], 'bounded-apex-window')
            self.assertLess(apex['dwell'], 3.)
        straight = {**track,'curvature':np.zeros(len(grid))}
        self.assertFalse(field_segments([(a,grid)]*3, straight, [('5',300.,0.)])['corners'])
        # Taken flat: detected for the circuit guide, never ranked as grip.
        self.assertFalse(any(c['grip_limited'] for c in bends))

    def test_mapped_turn_does_not_replace_a_braked_speed_minimum(self):
        from car_physics import field_segments
        grid = np.arange(0., 1005., 5.)
        curvature = np.zeros(len(grid)); curvature[(grid >= 220)&(grid <= 380)] = .004
        track = dict(grid=grid,x=grid,y=np.zeros(len(grid)),curvature=curvature,scale=1.)
        v = 290-70*np.exp(-((grid-300)/60)**2)  # braked dip to 220 km/h at 300 m
        a = np.zeros((len(grid),8));a[:,0]=grid;a[:,2]=v;a[:,3]=np.where(np.abs(grid-300)<90,40,100)
        a[:,4]=((grid>200)&(grid<290)).astype(float);a[:,1]=np.concatenate([[0],np.cumsum(np.diff(grid)/(v[1:]/3.6))])
        corners = field_segments([(a,grid)]*3, track, [('13',300.,0.)])['corners']
        self.assertEqual(len(corners), 1)
        self.assertFalse(corners[0].get('mapped_fast_bend'))
        self.assertEqual(corners[0]['turn'], '13')
        self.assertTrue(corners[0]['grip_limited'])

if __name__ == '__main__':
    unittest.main()
