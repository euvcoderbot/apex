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
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server
from capture_storage import repository_lock,atomic_bytes


def timestamp(value):
    result = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    return result if result.tzinfo else result.replace(tzinfo=timezone.utc)


def validate_finished(identity, classification, now):
    if identity.get('is_cancelled') or not identity.get('date_end') or timestamp(identity['date_end']) >= now:
        raise ValueError('Only completed sessions can be exported; live/future/cancelled sessions are excluded')
    if sum(isinstance(row.get('position'), (int, float)) and row['position'] > 0 for row in classification) < 3:
        raise ValueError('Session completion is not confirmed by source classification yet')


def merge_session_export(root, year, gp, round_number, session, payload):
    with repository_lock(root):
        return _merge_session_export(root,year,gp,round_number,session,payload)


def _merge_session_export(root, year, gp, round_number, session, payload):
    folder = root/'assets/data/prerendered'
    target = folder/'index.json'
    manifest = json.loads(target.read_text(encoding='utf-8'))
    revision_text = (root/'lib/cache-revision.mjs').read_text(encoding='utf-8')
    expected = re.search(r'SOURCE_REVISION\s*=\s*"([^"]+)"', revision_text).group(1)
    if manifest.get('sourceRevision') != expected:
        raise ValueError('Source revision mismatch: rebuild existing exports before merging a session')
    query = '/api/session?'+urlencode(sorted({'year':year, 'gp':gp, 'round':round_number, 'session':session}.items()))
    packed = gzip.compress(json.dumps(payload,separators=(',',':'),allow_nan=False).encode(),mtime=0)
    filename = hashlib.sha256(packed).hexdigest()[:24]+'.json.gz'
    atomic_bytes(folder/filename,packed)
    manifest['entries'][query] = filename
    manifest.setdefault('captures', {})[query] = payload['local_export']
    # Captures are timestamped snapshots, not a promise of live freshness.
    manifest.get('expires', {}).pop(query, None)
    manifest['generated'] = datetime.now(timezone.utc).isoformat()
    atomic_bytes(target,json.dumps(manifest,separators=(',',':')).encode())
    return query


def merge_local_session_capture(root,year,gp,round_number,session,payload):
    folder=root/'assets/data/local-captures';folder.mkdir(parents=True,exist_ok=True)
    target=folder/'index.json'
    with repository_lock(root):
        return _merge_locked_session_capture(root,year,gp,round_number,session,payload,folder,target)


def _merge_locked_session_capture(root,year,gp,round_number,session,payload,folder,target):
    text=(root/'lib/cache-revision.mjs').read_text(encoding='utf-8')
    revisions={name:re.search(symbol+r'\s*=\s*"([^"]+)"',text).group(1) for name,symbol in (
        ('sourceRevision','SOURCE_REVISION'),('backendRevision','BACKEND_REVISION'),('measurementRevision','RACE_REVISION'))}
    index=json.loads(target.read_text(encoding='utf-8')) if target.exists() else {'schema':'apex-local-captures-v1',**revisions,'entries':{}}
    policy_file=Path(root)/'lib'/'snapshot-policy.json'
    policy=json.loads(policy_file.read_text(encoding='utf-8')) if policy_file.is_file() else {}
    if any(index.get(name)!=value and index.get(name) not in policy.get(name,{}).get(value,[]) for name,value in revisions.items()):
        raise ValueError('Existing captured revisions differ; no local capture was replaced')
    previous={name:index.get(name) for name in revisions}
    index['entries']={key:{**previous,**entry} for key,entry in index.get('entries',{}).items()}
    index.update(revisions)
    query='/api/session?'+urlencode(sorted({'year':year,'gp':gp,'round':round_number,'session':session}.items()))
    captured_at=timestamp(payload['local_export']['captured_at'])
    previous_capture=index['entries'].get(query,{}).get('capturedAt')
    # A slower, older export can finish after a newer capture. Locking makes
    # the write exclusive; timestamp ordering prevents that stale replacement.
    if previous_capture and timestamp(previous_capture)>captured_at:
        return query
    packed=gzip.compress(json.dumps(payload,separators=(',',':'),allow_nan=False).encode(),mtime=0)
    filename=hashlib.sha256(packed).hexdigest()[:24]+'.json.gz'
    atomic_bytes(folder/filename,packed)
    index['entries'][query]={'file':filename,'capturedAt':payload['local_export']['captured_at'],**revisions}
    index['generated']=datetime.now(timezone.utc).isoformat()
    atomic_bytes(target,json.dumps(index,separators=(',',':')).encode())
    return query


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--year',type=int,required=True)
    parser.add_argument('--gp',required=True)
    parser.add_argument('--round',type=int,required=True)
    parser.add_argument('--session',required=True,help='Practice 1/2/3, Qualifying, Sprint Qualifying, Sprint or Race')
    parser.add_argument('--refresh',action='store_true',help='redownload mirrored streams to capture later corrections')
    args = parser.parse_args()
    revisions=(ROOT/'lib/cache-revision.mjs').read_text(encoding='utf-8')
    current=re.search(r'SOURCE_REVISION\s*=\s*"([^"]+)"',revisions).group(1)
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
    # The running local API can immediately reuse this exact parsed payload.
    server.write_prepared_cache('session',args.year,payload,server.SESSION_CACHE_SCHEMA,args.gp,args.round,session)
    mirror = [sys.executable,str(ROOT/'scripts/mirror-openf1.py'),'--year',str(args.year),'--gp',args.gp,
              '--sessions',session,'--include-recent']
    if args.refresh:
        mirror.append('--refresh')
    subprocess.run(mirror,cwd=ROOT,check=True)
    with tempfile.TemporaryDirectory(prefix='apex-session-export-') as staged_dir:
        staged_summary=Path(staged_dir)/'session.json'
        staged_summary.write_text(json.dumps(payload,separators=(',',':'),allow_nan=False),encoding='utf-8')
        subprocess.run([sys.executable,str(ROOT/'scripts/export-session-telemetry.py'),'--year',str(args.year),
                        '--gp',args.gp,'--sessions',session,'--cache-root',str(server.PREPARED_CACHE),
                        '--session-summary',str(staged_summary),'--output-dir',str(ROOT/'assets/data/local-telemetry'),
                        '--source-revision',current],cwd=ROOT,check=True)
    # Require a pack for every driver with an eligible timed lap. Missing
    # individual boundary observations remain explicit in the exporter report.
    telemetry_root=ROOT/'assets/data/local-telemetry'
    telemetry = json.loads((telemetry_root/'index.json').read_text())
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
        pack = json.loads(gzip.decompress((telemetry_root/file).read_bytes()))
        if str(best['lap']) not in pack['laps']:
            raise ValueError(f"Fastest source lap has no supported native trace: {driver['code']} L{best['lap']}")
    # Only record a complete session after its required driver packs validate.
    # Pack downloads may remain staged on failure, but the session/calendar
    # are not advertised as a successfully prepared public export.
    event.setdefault('session_statuses',{})[session] = 'completed'
    query = merge_local_session_capture(ROOT,args.year,args.gp,args.round,session,payload)
    calendar_path = ROOT/f'assets/data/events/{args.year}.json'
    calendar_path.parent.mkdir(parents=True,exist_ok=True)
    with repository_lock(ROOT):
        latest=json.loads(calendar_path.read_text(encoding='utf-8')) if calendar_path.exists() else calendar
        for current in latest:
            if current.get('round')==args.round and current.get('name')==args.gp:
                current.setdefault('session_statuses',{})[session]='completed'
        atomic_bytes(calendar_path,json.dumps(latest,separators=(',',':'),allow_nan=False).encode())
    print(json.dumps({'exported':query,'drivers':len(drivers),'sourceRevision':telemetry['sourceRevision'],
                      'note':'Captured snapshot; run again with --refresh to include source corrections. Build and publish to update the public site.'}),flush=True)


if __name__ == '__main__':
    main()
