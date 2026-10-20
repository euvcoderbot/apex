"""Print speed-domain car metrics for one qualifying session as a table.

usage: python scripts/show-speed-domain.py [year] [grand prix name]
Defaults to the verified 2026 Singapore recording, which needs no download.
Other events go through the same trace-batch endpoint code as the website.
"""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import Response
import server
from verified_sources import recorded_session

year = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
gp = sys.argv[2] if len(sys.argv) > 2 else 'Singapore Grand Prix'
recording = recorded_session(year, gp, 'Q')
if not recording:
    sys.exit(f'No verified recording for {year} {gp}; use the website or the trace-batch API for other events.')
teams = {}
for item in recording['telemetry']:
    s = item['selection']
    if s['team'] == s.get('team_name') and s['team'] != s['driver']:
        teams[s['team']] = s
result = server.car_performance_trace_batch(Response(), year, gp, json.dumps(list(teams.values())))
sd = result['speed_domain']
if sd.get('error'):
    sys.exit(sd['error'])


def cell(value, digits=3):
    return '-'.rjust(8) if value is None else f'{value:+8.{digits}f}'


print(f"{year} {gp} · {sd['method']} · {sd['corner_count']} grip-limited corners")
print('Cornering: seconds per lap behind the best car.  Straight/traction: seconds vs median car (negative = quicker).')
print('Braking: % longer braking than best.  Energy: km/h lost at full throttle above best.')
print('Reliability:', sd['reliability'], ' Excluded:', sd.get('excluded') or 'none')
header = ['lap gap %', 'low s', 'medium s', 'high s', 'traction', 'str 160-250', 'str 250+', 'braking %', 'energy']
print('team'.ljust(18)+''.join(h.rjust(12) for h in header))
rows = []
for team, car in sd['cars'].items():
    bands = car.get('cornering') or {}
    grip = [bands.get(b, {}) and bands[b].get('gap_s') for b in ('low', 'medium', 'high')]
    longitudinal = [car.get(k) and car[k].get('gap_to_median_s') for k in ('traction', 'straight_mid', 'straight_top')]
    braking = car.get('braking') and car['braking'].get('gap_pct')
    energy = car.get('energy') and car['energy'].get('gap_kmh')
    rows.append((result['teams'][team]['lap_gap'], team, grip, longitudinal, braking, energy))
for lap_gap, team, grip, longitudinal, braking, energy in sorted(rows):
    values = [cell(lap_gap, 2)]+[cell(v) for v in grip]+[cell(v) for v in longitudinal]+[cell(braking, 1), cell(energy, 0)]
    print(team[:17].ljust(18)+''.join(v.rjust(12) for v in values))
