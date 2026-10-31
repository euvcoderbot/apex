"""Teammate agreement of each speed-domain metric after removing the driver's overall lap time.

    python scripts/validate-speed-domain-partial.py <output of validate-speed-domain.py>

validate-speed-domain.py records, per driver and Grand Prix, each metric and the driver's best qualifying lap. A car metric
should be shared by the two drivers of one car (same car, different driver). But a faster car is also faster at everything, so a
metric that merely restates the lap-time order shows high teammate agreement without telling us anything about *where* the car
is strong. The test here regresses each metric on lap time within each Grand Prix, standardises the residual, and asks whether
teammates still agree. That agreement is the car-specific signal.

Confidence intervals bootstrap over Grands Prix, not over drivers, because drivers in one GP share conditions.
"""
import collections
import json
import sys

import numpy as np

METRICS = ['corner_low', 'corner_medium', 'corner_high', 'straight', 'straight_mid', 'straight_top', 'traction', 'braking', 'energy']


def load(path):
    raw = json.load(open(path))['raw']
    result = collections.defaultdict(lambda: collections.defaultdict(list))
    for key, grand_prix in raw.items():
        year = int(key[:4])
        by_team = collections.defaultdict(list)
        for driver, team in grand_prix['teams'].items():
            by_team[team].append(driver)
        pairs = [tuple(v) for v in by_team.values() if len(v) == 2]
        for metric in METRICS:
            drivers = [d for d, values in grand_prix['new'].items() if values.get(metric) is not None and d in grand_prix['best_time']]
            if len(drivers) < 8:
                continue
            lap = np.array([grand_prix['best_time'][d] for d in drivers])
            value = np.array([grand_prix['new'][d][metric] for d in drivers])
            design = np.column_stack([np.ones(len(lap)), lap])
            residual = value - design @ np.linalg.lstsq(design, value, rcond=None)[0]
            standardise = lambda x: (x - x.mean()) / (x.std() or 1)
            after, before = dict(zip(drivers, standardise(residual))), dict(zip(drivers, standardise(value)))
            rows = [(after[a], after[b], before[a], before[b]) for a, b in pairs if a in after and b in after]
            if rows:
                result[year][metric].append(rows)
    return result


def correlation(rows, i, j):
    x = np.array([r[i] for r in rows] + [r[j] for r in rows])
    y = np.array([r[j] for r in rows] + [r[i] for r in rows])
    return float(np.corrcoef(x, y)[0, 1])


def main(path):
    rng = np.random.default_rng(1)
    result = load(path)
    print(f"{'year':5}{'metric':15}{'pairs':>6}  {'raw r':>7}  {'after lap time':>15}  {'90% CI (over GPs)':>20}")
    for year in sorted(result):
        for metric in METRICS:
            grand_prix = result[year].get(metric)
            if not grand_prix:
                continue
            rows = [r for g in grand_prix for r in g]
            boots = []
            for _ in range(500):
                picked = [grand_prix[i] for i in rng.integers(0, len(grand_prix), len(grand_prix))]
                flat = [r for g in picked for r in g]
                if len(flat) > 5:
                    boots.append(correlation(flat, 0, 1))
            low, high = np.percentile(boots, [5, 95])
            print(f'{year:<5}{metric:15}{len(rows):>6}  {correlation(rows, 2, 3):>+7.2f}  {correlation(rows, 0, 1):>+15.2f}  [{low:+.2f}, {high:+.2f}]')


if __name__ == '__main__':
    main(sys.argv[1])
