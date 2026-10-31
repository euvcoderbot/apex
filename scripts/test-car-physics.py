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
            # Time ratio over the same fixed stretch: +3% grip is ~1-8% less time.
            self.assertGreater(corner(self.r, 'grip', band), 1.008, band)
            # Braking is part of the corner now, so the better-brakes car may
            # lead slow corners; grip must still beat the base and power cars.
            time = lambda car: self.r['cars'][car]['cornering'][band]['time_vs_median_s']
            self.assertLess(time('grip'), min(time(c) for c in ('base0', 'base1', 'base2', 'power'))-.05, band)

    def test_identical_cars_sampled_at_different_phases_agree(self):
        # 4 Hz sampling and GPS projection must not invent cornering time.
        for k in range(3):
            for band in ('low', 'medium', 'high'):
                self.assertLess(abs(self.r['cars'][f'base{k}']['cornering'][band]['time_vs_median_s']), .04, band)

    def test_packet_dropouts_are_explicitly_provisional(self):
        # Missing a speed trough cannot be reconstructed precisely from its
        # endpoints. Keep the estimate but never call a 1.1 s gap dense data.
        lap = simulate(rng=np.random.default_rng(11))
        keep = np.ones(len(lap), bool)
        keep[np.arange(5, len(lap)-5, 9)] = False
        keep[np.arange(6, len(lap)-5, 9)] = False
        keep[np.arange(7, len(lap)-5, 18)] = False  # gaps up to ~1.1 s
        r = speed_domain_metrics({**{f'base{k}': [simulate(rng=np.random.default_rng(k))] for k in range(3)}, 'gappy': [lap[keep]]})
        for band in ('low', 'medium', 'high'):
            value = r['cars']['gappy']['cornering'][band]
            self.assertIsNotNone(value['index'], band)
            self.assertTrue(value['provisional'], band)
        self.assertTrue(any(c['max_packet_gap_s'] > .6 for c in r['cars']['gappy']['corners']))

    def test_phases_add_up_to_the_corner_time(self):
        for car in self.r['cars'].values():
            for row in car['corners']:
                self.assertAlmostEqual(sum(row['phases_s'].values()), row['delta_s'], places=9)

    def test_more_grip_is_not_mistaken_for_straight_line_speed(self):
        # The grip car exits every corner faster. Window timing credits that
        # to the straight; equal-speed comparison must not.
        base = np.mean([index(self.r, f'base{k}', 'straight') for k in range(3)])
        self.assertAlmostEqual(index(self.r, 'grip', 'straight'), base, delta=.006)

    def test_more_power_shows_as_straight_line_not_cornering(self):
        # +5% power is ~1% less time over the same straight.
        self.assertLess(index(self.r, 'power', 'straight'), .995)
        self.assertEqual(self.r['cars']['power']['straight']['gap_pct'], 0.)
        # Small power changes have little influence in this simulated field.
        # This is not a promise to isolate power in real entry/exit traces.
        for band in ('low', 'medium', 'high'):
            self.assertAlmostEqual(corner(self.r, 'power', band), 1., delta=.004, msg=band)

    def test_better_brakes_show_as_shorter_braking_only(self):
        self.assertLess(index(self.r, 'brakes', 'braking'), .96)
        self.assertEqual(self.r['cars']['brakes']['braking']['gap_pct'], 0.)
        # Braking into a corner is part of the corner: it shows in that phase.
        low = self.r['cars']['brakes']['cornering']['low']['phases_s']
        self.assertLess(low['braking'], -.1)
        self.assertLess(abs(low['mid'])+abs(low['exit']), .05)

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


class CommonDistanceTimingTests(unittest.TestCase):
    def test_constant_acceleration_integrates_exactly_across_clipped_packets(self):
        from car_physics import _speed_trace_time
        t = np.arange(0., 5.1, .5)
        p = 30*t+2*t*t
        a = np.zeros((len(t), 8)); a[:, 1] = t; a[:, 2] = (30+4*t)*3.6
        distance = lambda time: 30*time+2*time*time
        self.assertAlmostEqual(_speed_trace_time(p, a, distance(.13), distance(4.81)), 4.68, places=10)

    def test_gps_residual_gradient_cannot_invent_time_at_constant_speed(self):
        from car_physics import _speed_trace_time, _time_at
        p = np.arange(0., 501., 5.)
        a = np.zeros((len(p), 8)); a[:, 0] = p; a[:, 1] = p/60; a[:, 2] = 216
        warped = p+4*np.sin(p/100)
        raw = _time_at(warped, a, 400)-_time_at(warped, a, 100)
        self.assertGreater(abs(raw-5), .05)  # old GPS-stretched timestamp score
        self.assertAlmostEqual(_speed_trace_time(warped, a, 100, 400), 5., places=10)

    def test_no_speculative_exit_credit_or_partial_band_extrapolation(self):
        result = field(grip={'mu': 1.03}, power={'power': 990.})
        for row in result['segments']['timed_corners']:
            self.assertEqual(row['timing_method'], 'common-distance-speed-integral')
            self.assertEqual(row['registration_shift_m'], 5.)
            for car in row['cars'].values():
                self.assertGreaterEqual(car['registration_sensitivity_s'], 0.)
        for car in result['cars'].values():
            for band in ('low', 'medium', 'high'):
                value = car['cornering'][band]
                if value and value['index'] is not None:
                    self.assertEqual(value['corners'], value['expected'])
                    self.assertAlmostEqual(value['time_vs_median_s'],
                        sum(c['delta_s'] for c in car['corners'] if c['band'] == band), places=10)


class TrackStraightTests(unittest.TestCase):
    """Straight line measured on the track's own straights between timed corners."""
    @classmethod
    def setUpClass(cls):
        cls.r = field(power={'power': 990.})

    def test_every_real_straight_is_measured_and_named_by_its_corners(self):
        straights = self.r['segments']['track_straights']
        self.assertGreaterEqual(len(straights), 4)
        for s in straights:
            self.assertGreaterEqual(s['metres'], 100)
            self.assertRegex(s['straight'], r'.+–.+')
        # The main straight crosses the timing line: two pieces, one straight.
        self.assertTrue(any(len(s['pieces']) == 2 for s in straights))

    def test_more_power_is_faster_on_the_straights_and_shares_of_lap_add_up(self):
        power = self.r['cars']['power']['track_straights']
        self.assertIsNotNone(power['index'])
        self.assertLess(power['time_vs_median_s'], 0)
        base = self.r['cars']['base0']['track_straights']
        self.assertAlmostEqual(base['time_vs_median_s'], 0, delta=.05)
        lap = self.r['cars']['power']['field_lap_time_s']
        self.assertGreater(lap, 30)
        self.assertLess(abs(power['time_vs_median_s'])/lap*100, abs(power['pct_vs_median']))


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
            # Low load and no field speed dip: nothing bounds an apex window.
            self.assertIsNone(car_apex(a,grid,c))
        straight = {**track,'curvature':np.zeros(len(grid))}
        self.assertFalse(field_segments([(a,grid)]*3, straight, [('5',300.,0.)])['corners'])
        # Taken flat: detected for the circuit guide, never ranked as grip.
        self.assertFalse(any(c['grip_limited'] for c in bends))

    def test_flat_high_load_bend_measures_scrub_not_power(self):
        from car_physics import field_segments, car_apex
        grid = np.arange(0., 1005., 5.)
        curvature = np.zeros(len(grid)); curvature[(grid >= 420)&(grid <= 580)] = .006  # ~3.3 g at 265 km/h
        track = dict(grid=grid,x=grid,y=np.zeros(len(grid)),curvature=curvature,scale=1.)
        def lap(base, lift=0.):
            v = base-4*np.exp(-((grid-500)/60)**2)-lift*np.exp(-((grid-500)/40)**2)
            a = np.zeros((len(grid),8));a[:,0]=grid;a[:,2]=v;a[:,3]=100
            a[:,1]=np.concatenate([[0],np.cumsum(np.diff(grid)/(v[1:]/3.6))]);return a
        strong, weak, lifting = lap(275), lap(262), lap(268, lift=12)
        bends = [c for c in field_segments([(x,grid) for x in (strong,weak,lifting)], track, [('10',500.,0.)])['corners'] if c['turn']=='10']
        self.assertEqual(len(bends), 1); bend = bends[0]
        self.assertTrue(bend['flat_load'] and bend['grip_limited'])
        s, w, l = (car_apex(x,grid,bend)['kmh'] for x in (strong,weak,lifting))
        self.assertAlmostEqual(s, w, delta=.5, msg='more power alone is not more cornering speed')
        self.assertLess(l, s-5, 'a lift in the bend costs speed')

    def test_flat_bend_scores_only_the_cars_that_lift(self):
        from car_physics import field_segments, corner_timing
        grid = np.arange(0., 1005., 5.)
        curvature = np.zeros(len(grid)); curvature[(grid >= 420)&(grid <= 580)] = .006  # ~3.3 g
        track = dict(grid=grid,x=grid,y=np.zeros(len(grid)),curvature=curvature,scale=1.)
        def lap(base, lift=0.):
            v = base-4*np.exp(-((grid-500)/60)**2)-lift*np.exp(-((grid-500)/40)**2)
            a = np.zeros((len(grid),8));a[:,0]=grid;a[:,2]=v
            a[:,3]=np.where(lift and np.abs(grid-500) < 40, 60., 100.)
            a[:,1]=np.concatenate([[0],np.cumsum(np.diff(grid)/(v[1:]/3.6))]);return a
        laps = {'strong': lap(278), 'weak': lap(266), 'mid': lap(272), 'lifting': lap(272, lift=14)}
        projected = {n: [(a, grid)] for n, a in laps.items()}
        seg = field_segments([lp for v in projected.values() for lp in v], track, [('10',500.,0.)])
        rows, _ = corner_timing(projected, seg['corners'], track, seg['field_speed'])
        self.assertEqual(len(rows), 1); cars = rows[0]['cars']
        self.assertTrue(rows[0]['flat_bend'])
        # More power through a flat bend is not cornering; lifting is.
        self.assertAlmostEqual(cars['strong']['delta_s'], cars['weak']['delta_s'], places=9)
        self.assertGreater(cars['lifting']['delta_s']-cars['strong']['delta_s'], .02)
        self.assertTrue(cars['lifting']['lifted'])

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
        # Flags are served as JSON: plain Python bools, never numpy scalars.
        for key in ('grip_limited', 'flat_load', 'braked'):
            self.assertIs(type(corners[0][key]), bool, key)

class CorruptLapTests(unittest.TestCase):
    """A lap whose distance disagrees with the field by more than 3% has corrupt samples (real captures had laps 55% off, and
    one whose minimum speed was 278 km/h); it must not decide a car's cornering, and must not disturb anyone else."""

    def base(self):
        return {f"base{k}": [simulate(rng=np.random.default_rng(k))] for k in range(4)}

    def test_a_lap_with_an_impossible_distance_is_excluded_and_says_why(self):
        bad = simulate(rng=np.random.default_rng(9))
        bad[:, 0] *= 1.4
        result = speed_domain_metrics({**self.base(), "bad": [bad]})
        self.assertNotIn("bad", result["cars"])
        self.assertIn("more than 3%", result["excluded"]["bad"])

    def test_the_other_cars_are_unchanged_by_the_corrupt_one(self):
        clean = speed_domain_metrics(self.base())
        bad = simulate(rng=np.random.default_rng(9))
        bad[:, 0] *= 0.45
        with_bad = speed_domain_metrics({**self.base(), "bad": [bad]})
        for name in clean["cars"]:
            for band in ("low", "medium", "high"):
                self.assertAlmostEqual(clean["cars"][name]["cornering"][band]["time_vs_median_s"],
                                       with_bad["cars"][name]["cornering"][band]["time_vs_median_s"], places=9)

    def test_normal_line_to_line_differences_are_kept(self):
        near = simulate(rng=np.random.default_rng(9))
        near[:, 0] *= 1.01
        result = speed_domain_metrics({**self.base(), "near": [near]})
        self.assertIn("near", result["cars"])


class AccelerationIndexContractTests(unittest.TestCase):
    def test_the_straight_needs_an_end_speed_or_a_distance(self):
        from car_physics import acceleration_index
        nodes = np.arange(105., 300., 10.)
        curves = {name: np.linspace(8, 1, len(nodes)) + i * .1 for i, name in enumerate("ABCD")}
        with self.assertRaisesRegex(ValueError, "v_end or distance_m"):
            acceleration_index(curves, nodes, 150.)
        index, info = acceleration_index(curves, nodes, 150., v_end=250.)
        self.assertTrue(info and info["distance_m"] > 20)
        index, info = acceleration_index(curves, nodes, 150., distance_m=400.)
        self.assertAlmostEqual(info["distance_m"], 400.)


if __name__ == '__main__':
    unittest.main()
