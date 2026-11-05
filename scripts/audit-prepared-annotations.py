"""Read-only audit of annotation changes against locally retained inputs. No network."""
import gzip
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from openf1_performance import red_flag_periods, lap_in_red_flag, neutralised_periods, lap_neutralised, stamp

root = Path(sys.argv[1]) / 'assets/data/local-captures'
raw = Path.home() / 'apex-data/openf1'
index = json.loads((root / 'index.json').read_text())
report = []
patches = []
for route, entry in index['entries'].items():
    if not route.startswith('/api/session?'):
        continue
    payload = json.loads(gzip.decompress((root / entry['file']).read_bytes()))
    key = payload.get('openf1_session_key')
    if not key:
        continue
    url = f'https://api.openf1.org/v1/race_control?session_key={key}'
    file = raw / (hashlib.sha256(url.encode()).hexdigest() + '.json.gz')
    if not file.exists():
        report.append({'session': key, 'missing_raw': True})
        continue
    controls = json.loads(gzip.decompress(file.read_bytes()))
    periods = red_flag_periods(controls)
    neutral = neutralised_periods(controls)
    differences = []
    changes = []
    for driver in payload.get('drivers', []):
        for lap in driver.get('laps', []):
            start = stamp(lap.get('date_start'))
            end = start + lap['time'] if start is not None and lap.get('time') else None
            current = lap_in_red_flag(start, end, periods)
            changes.append({'driver': driver['code'], 'lap': lap['lap'], 'red_flag': current, 'neutralised': lap_neutralised(start, end, neutral)})
            if current != bool(lap.get('red_flag')):
                differences.append({'driver': driver['code'], 'lap': lap['lap'], 'timed': lap.get('time') is not None, 'old': bool(lap.get('red_flag')), 'new': current})
    report.append({'session': key, 'event': payload.get('event'), 'name': payload.get('session'), 'changed_flags': len(differences), 'examples': differences[:3], 'unknown_teams': [d['code'] for d in payload.get('drivers', []) if not d.get('team') or d.get('team') == 'Unknown']})
    patches.append({'route': route, 'file': entry['file'], 'changes': changes})
if '--patches' in sys.argv and any(item.get('missing_raw') for item in report):
    raise SystemExit('Missing retained race-control input; no annotation migration is safe.')
print(json.dumps(patches if '--patches' in sys.argv else report, indent=2))
