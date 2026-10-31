"""Adversarial inputs for the numerical core: what raises, and what returns NaN or infinity without saying so.

    python scripts/audit-numeric.py

This is an audit, not a test: it prints findings. A finding becomes a regression test only once it is decided what the
function should do (raise a clear error, return None, or return a finite value). Inputs that the callers filter first
(the page and server drop non-finite telemetry before it gets here) are still tried, because a function that quietly
returns NaN is one refactor away from showing it.
"""
import math
import sys
import warnings
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import car_physics as cp
import pace_models as pm
import performance as perf

warnings.simplefilter('ignore')
nan, inf = float('nan'), float('inf')
findings = []


def finite(value):
    """True when every number inside value is finite; None counts as an honest 'no result'."""
    if value is None or isinstance(value, (str, bool)):
        return True
    if isinstance(value, dict):
        return all(finite(v) for v in value.values())
    if isinstance(value, (list, tuple)):
        return all(finite(v) for v in value)
    try:
        return bool(np.all(np.isfinite(np.asarray(value, dtype=float))))
    except (TypeError, ValueError):
        return True


def attempt(function, label, *args, **kwargs):
    name = f'{function.__module__}.{function.__name__}'
    try:
        result = function(*args, **kwargs)
    except Exception as error:  # noqa: BLE001 - the point is to see everything
        findings.append((name, label, 'RAISES', f'{type(error).__name__}: {str(error)[:80]}'))
        return None
    if not finite(result):
        findings.append((name, label, 'NON-FINITE', repr(result)[:80]))
    return result


# ---- generic arrays -----------------------------------------------------------------------------------------------
t = np.arange(0, 60, .25)
v = 120 + 80 * np.sin(t / 7)
cases_xy = {
    'empty': (np.array([]), np.array([])),
    'one sample': (np.array([0.]), np.array([100.])),
    'two samples': (np.array([0., 1.]), np.array([100., 101.])),
    'constant time': (np.zeros(50), np.linspace(100, 200, 50)),
    'duplicate times': (np.repeat(np.arange(25.), 2), np.linspace(100, 200, 50)),
    'time runs backwards': (np.arange(50.)[::-1], np.linspace(100, 200, 50)),
    'NaN in y': (np.arange(50.), np.r_[np.linspace(100, 200, 49), nan]),
    'inf in y': (np.arange(50.), np.r_[np.linspace(100, 200, 49), inf]),
    'negative speed': (np.arange(50.), np.linspace(-50, 200, 50)),
    'speed in m/s read as km/h': (np.arange(50.), np.linspace(20, 90, 50) / 3.6),
    'huge values': (np.arange(50.), np.linspace(1e9, 2e9, 50)),
    'all equal': (np.arange(50.), np.full(50, 150.)),
}

for label, (tt, yy) in cases_xy.items():
    attempt(cp.local_slope, label, tt, yy, 1.)
    attempt(cp.speed_since_minimum, label, yy, np.zeros(len(yy), bool))
    attempt(cp.acceleration_curve, label, yy, np.gradient(yy) if len(yy) > 1 else yy, 100., 300.)

# ---- straight simulation and the acceleration index -----------------------------------------------------------------
nodes = np.arange(105., 300., 10.)
good_curve = np.linspace(8, 1, len(nodes))
fallback = np.linspace(8, 1, len(nodes))
sim_cases = {
    'normal': (nodes, good_curve, 150., 400., fallback),
    'all NaN curve': (nodes, np.full(len(nodes), nan), 150., 400., fallback),
    'NaN in fallback': (nodes, good_curve, 150., 400., np.full(len(nodes), nan)),
    'negative acceleration everywhere': (nodes, np.full(len(nodes), -3.), 150., 400., fallback),
    'zero distance': (nodes, good_curve, 150., 0., fallback),
    'negative distance': (nodes, good_curve, 150., -50., fallback),
    'start speed zero': (nodes, good_curve, 0., 400., fallback),
    'start speed negative': (nodes, good_curve, -30., 400., fallback),
    'start above every node': (nodes, good_curve, 400., 400., fallback),
    'one finite node': (nodes, np.r_[good_curve[:1], np.full(len(nodes) - 1, nan)], 150., 400., fallback),
    'empty nodes': (np.array([]), np.array([]), 150., 400., np.array([])),
}
for label, args in sim_cases.items():
    attempt(cp.simulate_straight, label, *args)

curves = {n: good_curve + i * .1 for i, n in enumerate('ABCDEF')}
attempt(cp.acceleration_index, 'normal', curves, nodes, 150., v_end=250.)
attempt(cp.acceleration_index, 'two cars', {'A': good_curve, 'B': good_curve}, nodes, 150., v_end=250.)
attempt(cp.acceleration_index, 'one car all NaN', {**curves, 'A': np.full(len(nodes), nan)}, nodes, 150., v_end=250.)
attempt(cp.acceleration_index, 'v_end below v_start', curves, nodes, 250., v_end=150.)
attempt(cp.acceleration_index, 'neither v_end nor distance', curves, nodes, 150.)
attempt(cp.acceleration_index, 'distance zero', curves, nodes, 150., distance_m=0.)

# ---- lap preparation ------------------------------------------------------------------------------------------------
def lap(n=200, **override):
    D, T, V, THR, BRK, X, Y, DRS = range(8)
    a = np.zeros((n, 8))
    a[:, T] = np.arange(n) * .25
    a[:, D] = np.cumsum(np.full(n, 20.))
    a[:, V] = 150 + 60 * np.sin(np.arange(n) / 9)
    a[:, THR] = 100
    a[:, X], a[:, Y] = np.cos(np.arange(n) / 30) * 500, np.sin(np.arange(n) / 30) * 500
    for key, value in override.items():
        a[:, {'D': D, 'T': T, 'V': V, 'THR': THR, 'BRK': BRK}[key]] = value
    return a

for label, a in {
    'normal': lap(),
    'too few samples': lap(10),
    'all NaN speed': lap(V=nan),
    'all speeds zero': lap(V=0.),
    'throttle above 100': lap(THR=250),
    'duplicate timestamps': lap(T=1.),
    'distance not increasing': lap(D=5.),
}.items():
    attempt(cp.speed_minima, label, a)
    attempt(cp.apex_dwell, label, a, 5)

# ---- tyre and pace models -------------------------------------------------------------------------------------------
def stint(n, slope=.05, noise=0., start_age=1):
    rng = np.random.default_rng(1)
    return [{'lap': 10 + i, 'age': start_age + i, 'time': 90 + slope * i + noise * rng.standard_normal(), 'compound': 'MEDIUM', 'stint': 1}
            for i in range(n)]

stint_cases = {
    'normal 15': stint(15), 'three laps': stint(3), 'two laps': stint(2), 'empty': [],
    'identical times': [dict(r, time=90.) for r in stint(15)],
    'NaN time': [dict(r, time=nan) if i == 4 else r for i, r in enumerate(stint(15))],
    'inf time': [dict(r, time=inf) if i == 4 else r for i, r in enumerate(stint(15))],
    'age not advancing': [dict(r, age=5) for r in stint(15)],
    'negative lap time': [dict(r, time=-90.) for r in stint(15)],
    'all same age, many laps': [dict(r, age=3, lap=10 + i) for i, r in enumerate(stint(15))],
    'huge degradation': stint(20, slope=50.),
}
for label, laps in stint_cases.items():
    attempt(perf.fit_tyre_stint, label, laps)
    if laps:
        attempt(pm.tyre_curve, label, laps)
    attempt(perf.tyre_age_slope, label, [(r['age'], r['time']) for r in laps])
    attempt(perf.slope, label, [(r['lap'], r['time']) for r in laps])

for label, (matrix, target) in {
    'normal': (np.column_stack([np.ones(10), np.arange(10.)]), 90 + .1 * np.arange(10.)),
    'collinear columns': (np.column_stack([np.ones(10), np.ones(10)]), np.arange(10.)),
    'one row': (np.ones((1, 2)), np.ones(1)),
    'zero rows': (np.empty((0, 2)), np.empty(0)),
    'NaN target': (np.column_stack([np.ones(10), np.arange(10.)]), np.r_[np.ones(9), nan]),
    'inf matrix': (np.column_stack([np.ones(10), np.r_[np.arange(9.), inf]]), np.arange(10.)),
    'all-equal target': (np.column_stack([np.ones(10), np.arange(10.)]), np.full(10, 90.)),
}.items():
    attempt(pm.robust_fit, label, matrix, target)
    if len(target):
        attempt(perf.huber_fit, label, matrix, target)

for label, rounds in {
    'normal': [{'round': i, 'deficit': .5 + .02 * i, 'median_apex': 120, 'straight_share': .3} for i in range(1, 9)],
    'empty': [], 'one round': [{'round': 1, 'deficit': .4}],
    'NaN deficit': [{'round': i, 'deficit': nan if i == 3 else .5} for i in range(1, 9)],
    'duplicate rounds': [{'round': 1, 'deficit': .5 + i * .01} for i in range(8)],
    'missing keys': [{'round': i, 'deficit': .5} for i in range(1, 9)],
    'string numbers': [{'round': str(i), 'deficit': .5} for i in range(1, 9)],
    'negative deficits': [{'round': i, 'deficit': -1. - .1 * i} for i in range(1, 9)],
}.items():
    attempt(perf.compute_development_progression, label, rounds)

for label, value in {'string': 'abc', 'None': None, 'nan': nan, 'inf': inf, 'bool': True, 'empty string': '', 'list': [1]}.items():
    result = perf.number(value)
    if label == 'bool' and result is not None:
        findings.append(('performance.number', label, 'SURPRISE', f'True is accepted as {result}'))

# ---- report ---------------------------------------------------------------------------------------------------------
if not findings:
    print('No raised errors or non-finite results for the inputs tried.')
else:
    width = max(len(f[0]) for f in findings)
    for name, label, kind, detail in sorted(findings, key=lambda f: (f[2], f[0], f[1])):
        print(f'{kind:11} {name:{width}}  {label:34} {detail}')
    print(f'\n{len(findings)} findings')
