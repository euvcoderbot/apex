"""Plan and run short, session-driven OpenF1 archive jobs on Windows.

The schedule refresh is lightweight; only completed sessions are downloaded.
This script does not publish the website.
"""
import argparse
from contextlib import redirect_stdout
import gzip
import importlib.util
import json
import os
import re
import subprocess
import shutil
import sys
from urllib.request import urlopen
from argparse import Namespace
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server

spec = importlib.util.spec_from_file_location('apex_mirror', ROOT / 'scripts' / 'mirror-openf1.py')
mirror = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mirror)
WANTED = set(mirror.SESSIONS) | {'Practice 1', 'Practice 2', 'Practice 3'}
COMPUTE_STATE = 'local-compute-state.json'


def parse_date(value):
    try:
        value = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return value if value.tzinfo else None
    except (ValueError, TypeError):
        return None


def planned_starts(sessions, now):
    """Trigger 35 min after scheduled end, then retry; never infer completion."""
    starts = set()
    for session in sessions:
        end = parse_date(session.get('date_end'))
        if session.get('is_cancelled') or session.get('session_name') not in WANTED or end is None:
            continue
        due = end + timedelta(minutes=35)
        # Retain triggers still in their retry window when the daily schedule
        # refresh runs; otherwise it could cancel a session's final refresh.
        if now - timedelta(hours=9) < due <= now + timedelta(days=8):
            starts.add(due)
    return sorted(starts)


def finished(session):
    key = session['session_key']
    try:
        messages = server.openf1('race_control', session_key=key)
    except Exception:
        messages = []
    if any(str(m.get('flag') or '').upper() == 'CHEQUERED' or
           str(m.get('message') or '').upper() in {'CHEQUERED FLAG', 'SESSION FINISHED'} for m in messages):
        return True
    try:
        results = server.openf1('session_result', session_key=key)
    except Exception:
        results = []
    return len(results) >= 3 and any(row.get('position') is not None for row in results)


def event_for_session(session, events):
    """Match the exact calendar session timestamp, not just a circuit name."""
    start = parse_date(session.get('date_start'))
    name = session.get('session_name')
    if name == 'Sprint Shootout':
        name = 'Sprint Qualifying'
    matches = [event for event in events if start is not None and
               parse_date((event.get('session_dates') or {}).get(name)) == start]
    if len(matches) != 1 or not matches[0].get('name') or not matches[0].get('round'):
        raise ValueError(f'Cannot uniquely match session {session.get("session_key")} to an event')
    return matches[0], name


def schedule(year):
    """The year's session list. OpenF1 answers 401 to the free tier while a session is live
    (from 30 minutes before it starts to 30 minutes after it ends), which is exactly when these
    jobs run, so the last good list is kept on disk and used when the live one is refused."""
    cache = server.RAW_ROOT / f'schedule-{year}.json'
    try:
        # Metadata fallback diagnostics must not corrupt `plan`'s JSON stdout.
        with redirect_stdout(sys.stderr):
            sessions = server.openf1('sessions', year=year)
    except Exception as error:
        if cache.exists():
            print(f'Schedule unavailable ({error}); using the saved one.', file=sys.stderr, flush=True)
            return json.loads(cache.read_text(encoding='utf-8'))
        raise
    if sessions:
        cache.parent.mkdir(parents=True, exist_ok=True)
        temporary = cache.with_suffix('.tmp')
        temporary.write_text(json.dumps(sessions), encoding='utf-8')
        temporary.replace(cache)
    return sessions


def load_compute_state():
    try:
        return json.loads((server.RAW_ROOT / COMPUTE_STATE).read_text(encoding='utf-8'))
    except FileNotFoundError:
        return {'sessions': {}}


def save_compute_state(state):
    path = server.RAW_ROOT / COMPUTE_STATE
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(state, indent=1), encoding='utf-8')
    temporary.replace(path)


def revisions():
    source = (ROOT / 'lib' / 'cache-revision.mjs').read_text(encoding='utf-8')
    result = {}
    for field, name in [('sourceRevision', 'SOURCE_REVISION'), ('backendRevision', 'BACKEND_REVISION'),
                        ('measurementRevision', 'RACE_REVISION')]:
        found = re.search(name + r'\s*=\s*["\']([^"\']+)', source)
        if not found:
            raise ValueError(f'Missing {name} in local checkout')
        result[field] = found.group(1)
    return result


def sync_prepared():
    """Stage prepared snapshots in the current Site checkout; never publish."""
    target = Path(os.environ.get('APEX_SITE_CHECKOUT') or ROOT.parent / 'site-claude-latest-release').resolve()
    if target == ROOT.resolve():
        raise ValueError('Prepared-data source and Site checkout must differ')
    try:
        source_project = json.loads((ROOT / '.openai' / 'hosting.json').read_text(encoding='utf-8'))['project_id']
        target_project = json.loads((target / '.openai' / 'hosting.json').read_text(encoding='utf-8'))['project_id']
    except (OSError, KeyError, ValueError) as error:
        raise RuntimeError(f'Site checkout is missing or invalid: {target}') from error
    script = target / 'scripts' / 'sync-prepared-sessions.mjs'
    if source_project != target_project or not script.is_file():
        raise RuntimeError(f'Site checkout does not match this project: {target}')
    node = shutil.which('node.exe') or shutil.which('node')
    if not node:
        raise RuntimeError('Node.js is unavailable for prepared-data sync')
    subprocess.run([node, str(script), '--from', str(ROOT), '--to', str(target), '--apply'],
                   cwd=target, check=True, stdout=sys.stdout, stderr=sys.stderr,
                   creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    print(f'Staged prepared sessions in {target}. Publication is still separate.', flush=True)


def prepare_session(session, final):
    """Export native laps, then warm the same local calculations the site uses."""
    year = int(session['year'])
    event, name = event_for_session(session, server.event_calendar(year))
    node = shutil.which('node.exe') or shutil.which('node')
    if not node:
        raise RuntimeError('Node.js is unavailable')
    env = {**os.environ, 'APEX_LAUNCHER_NO_BROWSER': '1'}
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    subprocess.run([node, str(ROOT / 'scripts' / 'launch-local.mjs'), 'apex-local://start'],
                   cwd=ROOT, env=env, check=True, stdout=sys.stdout, stderr=sys.stderr, creationflags=flags)
    with urlopen('http://127.0.0.1:54123/api/local-status', timeout=5) as response:
        status = json.load(response)
    if status.get('mode') != 'local' or any(status.get(k) != v for k, v in revisions().items()):
        raise RuntimeError('Local server revision does not match this checkout; restart local compute')
    subprocess.run([sys.executable, str(ROOT / 'scripts' / 'export-local-session.py'),
                    '--year', str(year), '--gp', event['name'], '--round', str(event['round']), '--session', name],
                   cwd=ROOT, env=env, check=True, stdout=sys.stdout, stderr=sys.stderr, creationflags=flags)
    try:
        if name in {'Qualifying', 'Race'}:
            command = [node, str(ROOT / 'scripts' / 'precompute-local.mjs'), '--year', str(year),
                       '--gp', event['name'], '--capture', '--fresh', '--require-complete']
            command += ['--race'] if name == 'Race' else ['--qualifying-only']
            subprocess.run(command, cwd=ROOT, env=env, check=True, stdout=sys.stdout, stderr=sys.stderr, creationflags=flags)
    finally:
        # Export has succeeded: even if derived results are partial, stage the
        # validated captures and let the failed preparation remain retryable.
        sync_prepared()
    print(f'Prepared {event["name"]} {name} ({"settled" if final else "provisional"}); local only.', flush=True)
    from urllib.parse import urlencode
    key='/api/session?'+urlencode(sorted({'year':year,'gp':event['name'],'round':event['round'],'session':name}.items()))
    folder=ROOT/'assets/data/local-captures'
    index=json.loads((folder/'index.json').read_text(encoding='utf-8'))
    payload=json.loads(gzip.decompress((folder/index['entries'][key]['file']).read_bytes()))
    return payload.get('lap_data_complete') is False or payload.get('telemetry_complete') is False


def run_due(sessions, now):
    if mirror.acquire_watch_lock():
        print('Another archive job is running; leaving it alone.', flush=True)
        return None
    failures = []
    for session in sessions:
        end = parse_date(session.get('date_end'))
        key = session.get('session_key')
        if key is None or end is None or session.get('is_cancelled') or session.get('session_name') not in WANTED:
            continue
        age = now - end
        if age < timedelta(minutes=35) or age > timedelta(days=3):
            continue
        state = mirror.load_state()
        try:
            if not finished(session):
                print(f"Session {key}: no confirmed finish yet; retry later.", flush=True)
                continue
            provisional = state.get('provisional_sessions', {}).get(str(key), {})
            if str(key) not in state['sessions'] and not (provisional.get('ready') and age < timedelta(hours=mirror.SETTLE_HOURS, minutes=5)):
                args = Namespace(year=int(session.get('year') or now.year), gp=None, session_key=key,
                                 workers=3, dry_run=False, include_recent=True, refresh=False)
                mirror.run_once(args, {session['session_name']})
                state = mirror.load_state()
            final = str(key) in state['sessions']
            ready = final or state.get('provisional_sessions', {}).get(str(key), {}).get('ready')
            if not ready:
                continue
            compute = load_compute_state()
            phase = 'final' if final else 'provisional'
            recorded = compute['sessions'].get(str(key), {})
            if isinstance(recorded, dict) and not recorded.get('incomplete') and recorded.get('revisions') == revisions() and (recorded.get('phase') == phase or recorded.get('phase') == 'final'):
                continue
            incomplete=prepare_session(session, final) is True
            compute['sessions'][str(key)] = {'phase': phase, 'revisions': revisions(), 'incomplete': incomplete}
            save_compute_state(compute)
            if incomplete:
                failures.append({'session_key':key,'session':session.get('session_name'),
                                 'error':'Prepared supported laps; source lap history or telemetry remains incomplete; retry required'})
        except Exception as error:
            failures.append({'session_key': key, 'session': session.get('session_name'), 'error': str(error)})
            print(f"Session {key}: failed, will retry: {error}", flush=True)
    return failures


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['plan', 'run', 'refresh'])
    args = parser.parse_args()
    if args.mode == 'refresh':
        subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                        str(ROOT / 'scripts' / 'install-session-archive-task.ps1'), '-Refresh'],
                       cwd=ROOT, check=True, stdout=sys.stdout, stderr=sys.stderr,
                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        return
    now = datetime.now(timezone.utc)
    sessions = schedule(now.year)
    if args.mode == 'plan':
        print(json.dumps([d.astimezone().isoformat() for d in planned_starts(sessions, now)]))
    else:
        print(f"[{now.isoformat(timespec='seconds')}] checking recently finished sessions", flush=True)
        failures = run_due(sessions, now)
        if failures is None:
            return  # Busy is not a successful health check; retain the owner's report.
        # Reconcile work prepared before this scheduler update, or after an
        # interrupted sync. A failure must be visible to Task Scheduler.
        sync_prepared()
        health = {'checked_at': now.isoformat(), 'failures': failures}
        from capture_storage import atomic_bytes
        atomic_bytes(server.RAW_ROOT / 'pipeline-health.json', json.dumps(health).encode())
        if failures:
            raise SystemExit(1)


if __name__ == '__main__':
    if sys.stdout is None:  # pythonw has no console; preserve diagnostics in a log.
        log = Path.home() / 'apex-data' / 'session-archive.log'
        log.parent.mkdir(parents=True, exist_ok=True)
        sys.stdout = sys.stderr = log.open('a', encoding='utf-8', buffering=1)
    try:
        main()
    except Exception as error:
        from capture_storage import atomic_bytes
        health={'checked_at':datetime.now(timezone.utc).isoformat(),
                'failures':[{'stage':'scheduler','error':str(error)}]}
        atomic_bytes(server.RAW_ROOT/'pipeline-health.json',json.dumps(health).encode())
        raise
