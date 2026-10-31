"""Local-only API adapter: request practice timing directly from OpenF1.

The hosted parser and exported season retain their existing source identity.
All other routes use the shared backend, including native per-lap telemetry.
"""
from datetime import datetime, timezone
import time

from fastapi import FastAPI, HTTPException, Query, Response
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


app.mount('/', server.app)
