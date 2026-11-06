"""Local-only API adapter: request practice timing directly from OpenF1.

The hosted parser and exported season retain their existing source identity.
All other routes use the shared backend, including native per-lap telemetry.
"""
from datetime import datetime, timezone
import time

from fastapi import FastAPI, HTTPException, Query, Request, Response
import server

app = FastAPI()
@app.middleware('http')
async def guard_local_adapter(request,call_next):
    from api_security import local_request_allowed
    if request.url.path.startswith('/api/') and not local_request_allowed(request,server.CORS_ORIGINS):
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=403,content={'detail':'Local API origin or host not allowed'})
    return await call_next(request)

PRACTICE = {'FP1': 'Practice 1', 'FP2': 'Practice 2', 'FP3': 'Practice 3',
            'Practice 1': 'Practice 1', 'Practice 2': 'Practice 2', 'Practice 3': 'Practice 3'}


def practice_data(year, gp, round_number, session, fresh=False):
    identity = server.openf1_session(year, gp, session)
    if not identity or identity.get('session_name') != session or identity.get('year') != year:
        raise HTTPException(404, 'This practice session is not available from OpenF1 yet.')
    if round_number is not None:
        event = next((e for e in server.event_calendar(year) if e.get('round') == round_number), None)
        if not event or event.get('name') != gp:
            raise HTTPException(422, 'Grand Prix and round do not match the calendar.')
    start = server._parse_openf1_datetime(identity.get('date_start'))
    if identity.get('is_cancelled') or not start or start > datetime.now(timezone.utc):
        raise HTTPException(422, 'This practice session has not started or was cancelled.')
    retrieve = server.fetch_openf1_session_drivers.__wrapped__ if fresh else server.fetch_openf1_session_drivers
    drivers = retrieve(year, gp, session, int(time.time() // 120))
    if not drivers or not any(d.get('laps') for d in drivers):
        raise HTTPException(503, 'Practice timing has not been published yet. Retry when source data is available.')
    return {'event': gp, 'session': session, 'date': identity.get('date_start'),
            'drivers': drivers, 'corners': [], 'circuit_rotation': 0,
            'location': identity.get('location', ''), 'circuit_key': identity.get('circuit_key'),
            'openf1_session_key': identity['session_key'],
            'compounds': server.get_tire_nominations(year, gp),
            'lap_data_complete': all(d.get('lap_data_complete', True) for d in drivers),
            'local_compute': {'source': 'OpenF1', 'requested_at': datetime.now(timezone.utc).isoformat()}}


@app.get('/api/session')
def session_data(response: Response, year: int = Query(2025, ge=2014),
                 gp: str = Query('British Grand Prix'), round: int | None = Query(None, ge=1),
                 session: str = Query('Q'), fresh: bool = Query(False)):
    name = PRACTICE.get(session)
    if name and year >= 2023:
        # Recent timing must be revalidated. The local disk cache handles the
        # two-minute TTL; never freeze it in the long-lived prepared cache.
        response.headers['Cache-Control'] = 'no-store' if fresh else 'max-age=120'
        try:
            return practice_data(year, gp, round, name, fresh)
        except HTTPException as error:
            if error.status_code != 404:
                raise
            # Older weekends absent from OpenF1 can still use the archive.
    return server.session_data(response, year, gp, round, session, fresh)


# ---------- Live timing (this machine only; never part of the hosted site) ----------
import asyncio
import json as _json
import os
import re
from pathlib import Path

from fastapi import Body
from fastapi.responses import StreamingResponse

import live_timing

REPLAY_CACHE = Path(os.environ.get('APEX_REPLAY_CACHE') or server.CACHE)
LIVE = live_timing.LiveManager(Path(os.environ.get('APEX_LIVE_DIR') or Path.home() / 'apex-data' / 'live'), str(REPLAY_CACHE))
_SESSION_DIR = re.compile(r'^\d{4}-\d{2}-\d{2}_(.+)$')


def replay_sessions():
    """Sessions whose folders exist in the FastF1 cache, newest first: the ones a replay can read offline."""
    found = []
    for year_dir in REPLAY_CACHE.glob('[12][0-9][0-9][0-9]'):
        for event_dir in year_dir.iterdir():
            event = _SESSION_DIR.match(event_dir.name)
            if not event_dir.is_dir() or not event:
                continue
            for session_dir in event_dir.iterdir():
                session = _SESSION_DIR.match(session_dir.name)
                if session_dir.is_dir() and session:
                    found.append({'path': f'/static/{year_dir.name}/{event_dir.name}/{session_dir.name}/',
                                  'year': int(year_dir.name), 'event': event.group(1).replace('_', ' '),
                                  'session': session.group(1).replace('_', ' '), 'date': session_dir.name[:10]})
    return sorted(found, key=lambda s: (s['date'], s['path']), reverse=True)


@app.get('/api/live/status')
def live_status():
    return {**LIVE.status(), 'replays': replay_sessions()}


@app.get('/api/live/state')
def live_state():
    return LIVE.state.snapshot()


@app.get('/api/live/outline')
def live_outline():
    return LIVE.state.outline()


@app.get('/api/live/telemetry')
def live_telemetry(drivers: str = Query('', max_length=200), seconds: float = Query(60, gt=0, le=live_timing.TELEMETRY_SECONDS)):
    numbers = [d for d in drivers.split(',') if d.isdigit()][:6]
    return LIVE.state.telemetry_for(numbers, seconds)


@app.get('/api/live/laps')
def live_laps():
    return LIVE.state.lap_list()


@app.get('/api/live/lap')
def live_lap(driver: str = Query(..., pattern=r'^\d{1,3}$'), lap: str = Query('fastest', pattern=r'^(fastest|last|\d{1,3})$')):
    trace = LIVE.state.lap_trace(driver, lap)
    if not trace:
        raise HTTPException(404, 'That lap has not been completed in this session yet.')
    return trace


@app.post('/api/live/start')
def live_start(body: dict = Body(...)):
    mode = body.get('mode')
    if mode == 'live':
        return LIVE.start_live()
    if mode == 'replay':
        path = str(body.get('path') or '')
        if path not in {s['path'] for s in replay_sessions()}:
            raise HTTPException(404, 'That session is not in the local cache.')
        try:
            speed, start = float(body.get('speed', 1)), float(body.get('start', 0))
        except (TypeError, ValueError):
            raise HTTPException(422, 'Speed and start must be numbers.')
        return LIVE.start_replay(path, min(max(speed, .1), 200), max(start, 0))
    raise HTTPException(422, 'mode must be live or replay')


@app.post('/api/live/signin')
def live_signin(body: dict = Body(...)):
    """Sign in to the F1 TV account with FastF1's own sign-in. The email and password are used for this one request,
    passed straight to FastF1 (which talks only to Formula 1's sign-in service) and never stored or logged; FastF1
    stores the resulting token on this PC, which the live connection then uses."""
    # Copy-paste often brings a line break or tab along; those are never part of a password.
    email, password = str(body.get('email') or '').strip(), str(body.get('password') or '').strip('\r\n\t')
    if not email or not password:
        raise HTTPException(422, 'Enter your F1 TV email and password.')
    try:
        from fastf1.exceptions import F1AuthError
        from fastf1.internals.f1account import token_manager
        from fastf1.internals.f1account.login import login
    except Exception:
        raise HTTPException(501, 'FastF1 3.9.2 or newer is needed to sign in.')
    try:
        token_manager.get(force_renew=True, auth_func=lambda: login(email, password))
    except F1AuthError as exc:
        raise HTTPException(401, str(exc) or 'Formula 1 did not accept the sign-in.')
    finally:
        password = None
    return {'auth': live_timing.stored_token_status()}


@app.post('/api/live/signout')
def live_signout():
    """Forget the F1 TV sign-in stored on this PC."""
    try:
        from fastf1.internals.f1account import clear_token
        clear_token()
    except Exception as exc:
        raise HTTPException(500, f'Could not clear the stored sign-in: {exc}')
    return {'auth': live_timing.stored_token_status()}


@app.post('/api/live/stop')
def live_stop():
    return LIVE.stop()


@app.get('/api/live/stream')
async def live_stream(request: Request, drivers: str = Query('', max_length=200)):
    """Server-sent events: the timing snapshot at most twice a second, telemetry for chosen drivers, the outline when it changes."""
    numbers = [d for d in drivers.split(',') if d.isdigit()][:6]

    async def events():
        seen, outline_seen, beat = -1, None, 0.0
        yield 'retry: 2000\n\n'
        while not await request.is_disconnected():
            version = LIVE.state.version
            now = time.monotonic()
            if version != seen:
                seen = version
                payload = {'state': LIVE.state.snapshot(), 'source': LIVE.status()['source']}
                if numbers:
                    payload['telemetry'] = LIVE.state.telemetry_for(numbers, 20)
                outline = LIVE.state.outline()
                if outline['complete'] != outline_seen:
                    outline_seen = outline['complete']
                    payload['outline'] = outline
                yield f'data: {_json.dumps(payload, separators=(",", ":"), default=str)}\n\n'
                beat = now
            elif now - beat > 10:
                yield ': alive\n\n'
                beat = now
            await asyncio.sleep(.5)

    return StreamingResponse(events(), media_type='text/event-stream', headers={'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no'})


app.mount('/', server.app)
