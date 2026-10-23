"""Capture a completed session locally and merge it into the public exports.

Uses server.py's existing OpenF1 timing parser and native telemetry exporter.
Does not depend on the official timing archive or the hosted backend. Recent
sessions are labelled captured snapshots, not falsely marked as settled.
"""
import argparse
from datetime import datetime, timezone
import gzip
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server


def timestamp(value):
    result = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    return result if result.tzinfo else result.replace(tzinfo=timezone.utc)


def validate_finished(identity, classification, now):
    if identity.get('is_cancelled') or not identity.get('date_end') or timestamp(identity['date_end']) >= now:
        raise ValueError('Only completed sessions can be exported; live/future/cancelled sessions are excluded')
    if sum(isinstance(row.get('position'), (int, float)) and row['position'] > 0 for row in classification) < 3:
        raise ValueError('Session completion is not confirmed by source classification yet')


def merge_session_export(root, year, gp, round_number, session, payload):
    folder = root/'assets/data/prerendered'
    target = folder/'index.json'
    manifest = json.loads(target.read_text(encoding='utf-8'))
    revision_text = (root/'lib/cache-revision.mjs').read_text(encoding='utf-8')
    expected = re.search(r'SOURCE_REVISION\s*=\s*"([^"]+)"', revision_text).group(1)
    if manifest.get('sourceRevision') != expected:
        raise ValueError('Source revision mismatch: rebuild existing exports before merging a session')
    query = '/api/session?'+urlencode(sorted({'year':year, 'gp':gp, 'round':round_number, 'session':session}.items()))
    packed = gzip.compress(json.dumps(payload,separators=(',',':'),allow_nan=False).encode(),mtime=0)
    filename = hashlib.sha256(query.encode()).hexdigest()[:24]+'.json.gz'
    (folder/filename).write_bytes(packed)
    manifest['entries'][query] = filename
    manifest.setdefault('captures', {})[query] = payload['local_export']
    manifest['generated'] = datetime.now(timezone.utc).isoformat()
    target.write_text(json.dumps(manifest,separators=(',',':')),encoding='utf-8')
    return query


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--year',type=int,required=True)
    parser.add_argument('--gp',required=True)
    parser.add_argument('--round',type=int,required=True)
    parser.add_argument('--session',required=True,help='Practice 1/2/3, Qualifying, Sprint Qualifying, Sprint or Race')
    parser.add_argument('--refresh',action='store_true',help='redownload mirrored streams to capture later corrections')
    args = parser.parse_args()
    if args.refresh:
        server.openf1 = lambda endpoint, **params: server._openf1_fetch(server.openf1_url(endpoint,**params))
    session = {'FP1':'Practice 1','FP2':'Practice 2','FP3':'Practice 3','Q':'Qualifying','SQ':'Sprint Qualifying','S':'Sprint','R':'Race'}.get(args.session,args.session)
    now = datetime.now(timezone.utc)
    identity = server.openf1_session(args.year,args.gp,session)
    if not identity or identity.get('year') != args.year or identity.get('session_name') != session:
        raise ValueError('Exact source session could not be resolved')
    classification = server.openf1('session_result',session_key=identity['session_key'])
    validate_finished(identity,classification,now)
    calendar = server.event_calendar(args.year)
    event = next((e for e in calendar if e.get('name') == args.gp and e.get('round') == args.round),None)
    if event is None:
        raise ValueError('Grand Prix and round do not match the calendar')
    drivers = server.fetch_openf1_session_drivers.__wrapped__(args.year,args.gp,session,0)
    if not drivers or any(not d.get('lap_data_complete',True) for d in drivers):
        raise ValueError('Incomplete source lap sequence; no public export written')
    captured = datetime.now(timezone.utc).isoformat()
    snapshot = {'captured_at':captured,'session_ended_at':identity['date_end'],
                'session_key':identity['session_key'],'source':'OpenF1 via local compute',
                'provisional':(now-timestamp(identity['date_end'])).total_seconds()<6*3600}
    payload = {'event':args.gp,'session':session,'date':identity['date_start'],'drivers':drivers,
               'corners':[],'circuit_rotation':0,'location':identity.get('location',''),
               'circuit_key':identity.get('circuit_key'),'openf1_session_key':identity['session_key'],
               'compounds':server.get_tire_nominations(args.year,args.gp),'lap_data_complete':True,
               'local_export':snapshot}
    print(json.dumps({'event':args.gp,'session':session,'drivers':len(drivers),
                      'laps':sum(len(d['laps']) for d in drivers),'snapshot':snapshot}),flush=True)
    # Update only the requested event's completion evidence; future sessions
    # retain their calendar status. No synthetic "completed" flag for the GP.
    event.setdefault('session_statuses',{})[session] = 'completed'
    query = merge_session_export(ROOT,args.year,args.gp,args.round,session,payload)
    calendar_path = ROOT/f'assets/data/events/{args.year}.json'
    calendar_path.parent.mkdir(parents=True,exist_ok=True)
    calendar_path.write_text(json.dumps(calendar,separators=(',',':'),allow_nan=False),encoding='utf-8')
    # The running local API can immediately reuse this exact parsed payload.
    server.write_prepared_cache('session',args.year,payload,server.SESSION_CACHE_SCHEMA,args.gp,args.round,session)
    mirror = [sys.executable,str(ROOT/'scripts/mirror-openf1.py'),'--year',str(args.year),'--gp',args.gp,
              '--sessions',session,'--include-recent']
    if args.refresh:
        mirror.append('--refresh')
    subprocess.run(mirror,cwd=ROOT,check=True)
    subprocess.run([sys.executable,str(ROOT/'scripts/export-session-telemetry.py'),'--year',str(args.year),
                    '--gp',args.gp,'--sessions',session,'--cache-root',str(server.PREPARED_CACHE)],cwd=ROOT,check=True)
    # Require a pack for every driver with an eligible timed lap. Missing
    # individual boundary observations remain explicit in the exporter report.
    telemetry = json.loads((ROOT/'assets/data/telemetry/index.json').read_text())
    missing = [d['code'] for d in drivers if any(not lap.get('out_lap') and isinstance(lap.get('time'),(int,float)) and 20<lap['time']<300 for lap in d['laps'])
               and f"{args.year}:{args.gp}:{session}:{d['code']}" not in telemetry['entries']]
    if missing:
        raise ValueError('Drivers without exported native telemetry: '+', '.join(missing))
    for driver in drivers:
        eligible = [lap for lap in driver['laps'] if not lap.get('out_lap') and isinstance(lap.get('time'),(int,float)) and 20<lap['time']<300]
        if not eligible:
            continue
        best = min(eligible,key=lambda lap:lap['time'])
        file = telemetry['entries'][f"{args.year}:{args.gp}:{session}:{driver['code']}"]
        pack = json.loads(gzip.decompress((ROOT/'assets/data/telemetry'/file).read_bytes()))
        if str(best['lap']) not in pack['laps']:
            raise ValueError(f"Fastest source lap has no supported native trace: {driver['code']} L{best['lap']}")
    print(json.dumps({'exported':query,'drivers':len(drivers),'sourceRevision':telemetry['sourceRevision'],
                      'note':'Captured snapshot; run again with --refresh to include source corrections. Build and publish to update the public site.'}),flush=True)


if __name__ == '__main__':
    main()
