"""Read-only inventory of complete native 100–150 crossings on selected laps."""
import json, sys
from collections import Counter
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import performance_tracks as pt

data = json.loads(Path(sys.argv[1]).read_text())
selections = {s['team']: s for s in data['selections']}
for team, samples, error in data['extracted']:
    counts = Counter()
    if not samples:
        print(json.dumps({'team': team, 'error': error})); continue
    item = pt.prepare(samples, selections[team], require_gps=False)
    a = item['a']; intervals = pt.source_intervals(item)
    for i in range(1, len(a)):
        if not a[i-1, 2] < 100 <= a[i, 2]: continue
        stop = next((j for j in range(i, len(a)) if a[j, 2] >= 150 or a[j, 2] < 92), None)
        if stop is None or a[stop, 2] < 150: continue
        counts['complete_crossings'] += 1
        t, v = a[i-1:stop+1, 1], a[i-1:stop+1, 2]
        if np.max(intervals[i-1:stop]) > .6: counts['source_gap'] += 1
        if np.any(np.diff(v) < -3): counts['speed_rebound'] += 1
        if np.any(np.diff(v)/np.diff(t)/3.6 > 3*9.80665): counts['implausible_jump'] += 1
        if np.any(a[i-1:stop+1, 4] >= .5): counts['brake_in_bracket'] += 1
        if np.min(a[i-1:stop+1, 3]) < 70: counts['throttle_below_70_in_bracket'] += 1
        if pt.acceleration_interval_supported(t, v, intervals[i-1:stop]) and not np.any(a[i-1:stop+1,4]>=.5) and np.min(a[i-1:stop+1,3])>=70:
            counts['passes_native_brackets'] += 1
    print(json.dumps({'team': team, **counts}))
