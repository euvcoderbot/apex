"""Capture exact native fastest laps for the failed completed-session load.

Only source observations are retained; each current metric is still recomputed.
Checkpointing prevents repeating successful downloads after a provider throttle.
"""
from datetime import datetime, timedelta, timezone
import gzip
import hashlib
import json
from pathlib import Path
import sys
import time
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server
from openf1_performance import retained_bundle, session_payload, adapt_performance

YEAR, GP, CODE = 2026, 'Azerbaijan Grand Prix', 'Q'
bundle = retained_bundle(YEAR, GP, CODE)
if bundle is None:
    raise ValueError('Exact completed-session timing bundle required')
identity = bundle['session']
payload = session_payload(YEAR, GP, CODE, bundle)
payload['compounds'] = server.get_tire_nominations(YEAR, GP)
adapted = adapt_performance(YEAR, GP, CODE, bundle)
target = ROOT.parent / 'outputs' / 'azerbaijan-2026-qualifying-native-v135.json'
capture = json.loads(target.read_text()) if target.exists() else {
    'session_key': identity['session_key'], 'captured_at': datetime.now(timezone.utc).isoformat(), 'telemetry': []}
if capture['session_key'] != identity['session_key']:
    raise ValueError('Checkpoint belongs to another session')
next_request = 0


def get(endpoint, **params):
    global next_request
    time.sleep(max(0, next_request-time.monotonic()))
    next_request = time.monotonic()+2.1
    for attempt in range(4):
        try:
            return server.openf1(endpoint, **params)
        except server.HTTPError as error:
            if error.code not in (429, 502, 503, 504) or attempt == 3:
                raise
            time.sleep(5*(attempt+1))


for driver in payload['drivers']:
    candidates = [r for r in adapted.apex_recorded_rows if r['driver'] == driver['code'] and r['accurate']
                  and r['phase'] in ('Q1', 'Q2', 'Q3') and r['compound'] in ('SOFT', 'MEDIUM', 'HARD') and r['rain'] is False]
    if not candidates:
        continue
    lap = min(candidates, key=lambda r: r['time'])
    selection = {'driver': lap['driver'], 'driver_number': lap['number'], 'team': lap['team'],
                 'lap': lap['lap'], 'time': lap['time'], 'start': lap['start'], 'end': lap['end'],
                 'sectors': lap['sectors'], 'phase': lap['phase'], 'compound': lap['compound'],
                 'timing_clock': 'openf1-session-start'}
    previous = next((t for t in capture['telemetry'] if t['selection']['driver'] == lap['driver'] and
                     t['selection']['lap'] == lap['lap'] and abs(t['selection']['time']-lap['time']) < .0005), None)
    if previous:
        continue
    start = datetime.fromisoformat(lap['date_start'])
    next_lap = next((r for r in bundle['feeds']['laps'] if str(r['driver_number']) == lap['number'] and
                     r['lap_number'] == lap['lap']+1), {})
    streams = {endpoint: get(endpoint, session_key=identity['session_key'], driver_number=lap['number'],
                            **{'date>=': (start-timedelta(seconds=2)).isoformat(),
                               'date<=': (start+timedelta(seconds=lap['time']+2)).isoformat()})
               for endpoint in ('car_data', 'location')}
    for rows in streams.values():
        if any(r.get('session_key') != identity['session_key'] or str(r.get('driver_number')) != lap['number'] for r in rows):
            raise ValueError('Native stream identity mismatch')
    samples = server._openf1_lap_telemetry.__wrapped__(YEAR, GP, CODE, lap['number'], lap['lap'], 0,
               identity['session_key'], lap['date_start'], lap['time'], next_lap.get('date_start'), streams)
    coverage, complete = server.position_geometry_quality(samples)
    if len(samples) < 30 or abs(samples[0]['ElapsedSeconds']) > .0001 or abs(samples[-1]['ElapsedSeconds']-lap['time']) > .0001:
        raise ValueError(f"Incomplete native timing window for {lap['driver']}")
    capture['telemetry'].append({'selection': selection, 'samples': samples, 'source': 'OpenF1',
                                'position_coverage': coverage, 'position_complete': complete,
                                'archive_sha256': hashlib.sha256(json.dumps(streams, sort_keys=True).encode()).hexdigest()})
    target.write_text(json.dumps(capture, separators=(',', ':'), allow_nan=False))
    print(json.dumps({'driver': lap['driver'], 'lap': lap['lap'], 'samples': len(samples),
                      'position_coverage': coverage, 'position_complete': complete}), flush=True)

if 'corners' not in capture:
    geometry = ROOT.parent / 'outputs' / 'baku-circuit-v135.json'
    if not geometry.exists():
        subprocess.run([shutil.which('node') or r'C:\Program Files\nodejs\node.exe',
                        str(ROOT / 'scripts' / 'capture-circuit.mjs'), str(identity['circuit_key']), str(YEAR), str(geometry)], check=True)
    metadata = json.loads(geometry.read_text())
    circuit, source_year = metadata['circuit'], metadata['source_year']
    if circuit['circuitKey'] != identity['circuit_key'] or source_year > YEAR:
        raise ValueError('Circuit source identity mismatch')
    capture['circuit'] = circuit
    capture['circuit_source_year'] = source_year
    capture['corners'] = [{'number': str(c['number']), 'letter': str(c.get('letter') or ''),
                           'x': c['trackPosition']['x'], 'y': c['trackPosition']['y'],
                           'angle': c.get('angle'), 'distance': None, 'fraction': None} for c in circuit['corners']]
    target.write_text(json.dumps(capture, separators=(',', ':'), allow_nan=False))

payload['corners'] = capture['corners']
payload['circuit_rotation'] = capture['circuit'].get('rotation', 0)
payload['circuit_source_year'] = capture['circuit_source_year']
payload['available_telemetry'] = [{'driver': t['selection']['driver'], 'lap': t['selection']['lap']} for t in capture['telemetry']]
source = json.dumps(payload, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
captured = datetime.fromisoformat(bundle['captured_at']).timestamp()
record = {'year': YEAR, 'data': payload, 'expires': captured+30*86400,
          'captured_at': bundle['captured_at'], 'source_sha256': hashlib.sha256(source).hexdigest(),
          'telemetry_captured_at': capture['captured_at'], 'corners': capture['corners'], 'telemetry': capture['telemetry']}
with gzip.open(ROOT / 'verified-sources.json.gz', 'rt', encoding='utf-8') as stream:
    packed = json.load(stream)
packed['sessions'][f'{YEAR}:{GP}:{CODE}'] = record
(ROOT / 'verified-sources.json.gz').write_bytes(gzip.compress(json.dumps(packed, separators=(',', ':'), allow_nan=False).encode(), mtime=0))
print(json.dumps({'retained_drivers': len(payload['drivers']), 'native_laps': len(capture['telemetry']),
                  'corners': len(capture['corners'])}), flush=True)
