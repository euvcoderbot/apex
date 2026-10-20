"""Does each category carry car information beyond overall lap time?

residual teammate r: teammate agreement after regressing each driver's
within-GP metric score on their within-GP lap-time score. A metric that only
re-states the lap-time order scores ~0 here even if raw agreement is high.
category overlap: mean |correlation| between different categories of the
same method; high values mean categories duplicate each other.
"""
import json, sys, math
from collections import defaultdict
from statistics import NormalDist
import numpy as np

data = json.load(open(sys.argv[1]))['raw']
methods = sys.argv[2].split(',') if len(sys.argv) > 2 else ['old', 'new']


def nscore(values):
    names = sorted(values, key=values.get)
    return {n: NormalDist().inv_cdf((i+.5)/len(names)) for i, n in enumerate(names)}


def icc(pairs):
    a = np.array(pairs)
    return float(np.corrcoef(np.r_[a[:, 0], a[:, 1]], np.r_[a[:, 1], a[:, 0]])[0, 1]) if len(a) >= 8 else None


for year in ('2025', '2026'):
    for method in methods:
        resid_pairs, scores = defaultdict(list), defaultdict(dict)
        for gp, row in data.items():
            if not gp.startswith(year):
                continue
            metrics = row[method]
            keys = {k for m in metrics.values() for k in m}
            for key in keys:
                vals = {d: m[key] for d, m in metrics.items() if m.get(key) is not None and math.isfinite(m[key])}
                if len(vals) < 6:
                    continue
                z = nscore(vals)
                lt = nscore({d: row['best_time'][d] for d in vals})
                x, y = np.array([lt[d] for d in vals]), np.array([z[d] for d in vals])
                slope = float(np.dot(x, y)/np.dot(x, x))
                resid = {d: z[d]-slope*lt[d] for d in vals}
                teams = defaultdict(list)
                for d in vals:
                    teams[row['teams'][d]].append(resid[d])
                    scores[key][(gp, d)] = z[d]
                for pair in teams.values():
                    if len(pair) == 2:
                        resid_pairs[key].append(tuple(pair))
        keys = sorted(scores)
        overlap = []
        for i, a in enumerate(keys):
            for b in keys[i+1:]:
                if {a, b} <= {'straight', 'straight_mid', 'straight_top'}:
                    continue
                common = set(scores[a]) & set(scores[b])
                if len(common) > 30:
                    overlap.append(abs(np.corrcoef([scores[a][c] for c in common], [scores[b][c] for c in common])[0, 1]))
        print(f'{year} {method}: mean |r| between categories = {np.mean(overlap):.2f}')
        for key in keys:
            r = icc(resid_pairs[key])
            print(f'   {key:13} residual teammate r = {"  -  " if r is None else f"{r:+.2f}"}  ({len(resid_pairs[key])} pairs)')
