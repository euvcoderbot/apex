"""FastF1 and OpenF1 API for euV2 data."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from bisect import bisect_left, bisect_right
from collections import deque
from functools import lru_cache
from datetime import datetime, timedelta, timezone
import gzip
import hashlib
import logging
import json
import os
from pathlib import Path
import threading
import time
import math
import re
import importlib
from html import unescape
from html.parser import HTMLParser
import unicodedata
from typing import Any
from urllib.request import Request as URLRequest, urlopen
from urllib.error import HTTPError
from uuid import uuid4
from threading import Lock

# Direct OpenF1 retrieval only needs standard-library numerics. Load the
# dataframe stack only when a FastF1/session operation actually uses it.
class _AnalysisModule:
    def __init__(self, name):
        self.name = name

    def __getattr__(self, name):
        return getattr(importlib.import_module(self.name), name)


np = _AnalysisModule('numpy')
pd = _AnalysisModule('pandas')
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).parent
DEFAULT_CACHE_ROOT = Path("/tmp/apex-data") if os.environ.get("VERCEL") else ROOT
RUNTIME_CACHE_ROOT = Path(os.environ.get("APEX_CACHE_ROOT", DEFAULT_CACHE_ROOT))
RUNTIME_CACHE_ROOT.mkdir(parents=True, exist_ok=True)
CACHE = RUNTIME_CACHE_ROOT / ".fastf1-cache"
CACHE.mkdir(exist_ok=True)
PREPARED_CACHE = RUNTIME_CACHE_ROOT / ".apex-cache"
PREPARED_CACHE.mkdir(exist_ok=True)
# Raw OpenF1 data is the one thing that is slow to get back (rate limited, hours
# per season) and never changes once a session is settled, while every
# calculation built on it does. It lives outside the repo and any worktree so a
# moved or deleted checkout cannot take it along. Override with APEX_RAW_ROOT.
RAW_ROOT = Path(os.environ.get("APEX_RAW_ROOT") or (
    PREPARED_CACHE / "openf1" if os.environ.get("VERCEL") else Path.home() / "apex-data" / "openf1"))
PREPARED_CACHE_VERSION = "v6"
SESSION_CACHE_SCHEMA = "session-identity-weather-v6"

app = FastAPI(title="euV2 data API")
# Browsers may read this API from the published site and from a dashboard on this machine,
# not from any page on the web. Set APEX_CORS_ORIGINS (comma separated) to add origins.
CORS_ORIGINS = [origin.strip() for origin in os.environ.get(
    "APEX_CORS_ORIGINS", "https://f1apexdata.eufrandota14.chatgpt.site").split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=r"^http://(127\.0\.0\.1|localhost)(:\d+)?$",
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=900, compresslevel=5)
OPENF1 = "https://api.openf1.org/v1"
logger = logging.getLogger("apex.telemetry")


def fastf1_runtime():
    # OpenF1's selected-lap path does not need FastF1. Avoid importing its
    # additional parser dependencies during a telemetry-only cold start.
    import fastf1
    if not getattr(fastf1_runtime, "configured", False):
        fastf1.Cache.enable_cache(str(CACHE))
        fastf1_runtime.configured = True
    return fastf1


ARCHIVE_RETRY_S = 86400
# Per-season breaker: the archive refuses whole seasons at once (October 2026:
# HTTP 401 from 2023 on, while 2022 and earlier still load), so after a few
# failures in a row on different sessions of one season, stop trying that
# season instead of paying ~13 s per failed load. An open breaker is kept on
# disk for a day so a restart does not pay for the failures again.
ARCHIVE_BREAKER_FAILURES = 3
ARCHIVE_BREAKER_COOLDOWN_S = 1800
_archive_failures: dict[int, list[float]] = {}
_archive_breaker_lock = Lock()


def archive_breaker_open(year) -> bool:
    with _archive_breaker_lock:
        failures = _archive_failures.get(int(year), [])
        if (len(failures) >= ARCHIVE_BREAKER_FAILURES
                and time.time()-failures[-1] < ARCHIVE_BREAKER_COOLDOWN_S):
            return True
    marker = read_prepared_cache("archive-season-unavailable", 0, int(year))
    return bool(marker and time.time()-float(marker.get("at", 0)) < ARCHIVE_RETRY_S)


def record_archive_result(year, ok: bool) -> None:
    with _archive_breaker_lock:
        failures = _archive_failures.setdefault(int(year), [])
        if ok:
            failures.clear()
        else:
            failures.append(time.time())
            del failures[:-ARCHIVE_BREAKER_FAILURES]
        opened = len(failures) >= ARCHIVE_BREAKER_FAILURES
    if ok:
        prepared_cache_path("archive-season-unavailable", 0, int(year)).unlink(missing_ok=True)
    elif opened:
        write_prepared_cache("archive-season-unavailable", 0, {"at": time.time()}, int(year))


def archive_usable(year, gp, session) -> bool:
    """False when the F1 timing archive is disabled here or failed recently."""
    if os.environ.get("APEX_F1_ARCHIVE", "off" if os.environ.get("VERCEL") else "on") == "off":
        return False
    if archive_breaker_open(year):
        return False
    marker = read_prepared_cache("archive-unavailable", year, gp, session)
    return not (marker and time.time()-float(marker.get("at", 0)) < ARCHIVE_RETRY_S)


def mark_archive_unusable(year, gp, session) -> None:
    write_prepared_cache("archive-unavailable", year, {"at": time.time()}, gp, session)


def archive_guard(year, gp, session, loader):
    """Skip the F1 timing archive for a day after it fails for a session.

    The archive has been returning HTTP 401/404; each attempt cost several
    seconds of failing feed requests before the OpenF1 fallback, on every
    request and every restart. A marker on disk short-circuits that.
    """
    # Serverless instances start with an empty /tmp, so a failure marker does
    # not survive there; the archive is skipped outright unless enabled.
    if not archive_usable(year, gp, session):
        raise RuntimeError("Timing archive unavailable for this session (disabled or failed recently)")
    try:
        data = loader()
        if getattr(data, "laps", None) is not None and data.laps.empty:
            raise ValueError("Timing archive returned no laps")
        record_archive_result(year, True)
        return data
    except Exception:
        mark_archive_unusable(year, gp, session)
        record_archive_result(year, False)
        raise


def load_fresh_session(year, gp, session, telemetry=False):
    fastf1_runtime()
    from session_loader import load_fresh_session as load
    return archive_guard(year, gp, session, lambda: load(year, gp, session, telemetry=telemetry))


@app.get("/api/health")
def health() -> dict[str, str]:
    """Lightweight hosting health check that never downloads F1 data."""
    return {"status": "ok", "prepared_cache_version": PREPARED_CACHE_VERSION,
            "tyre_fit_method": "theil-sen-residual-screen-v4-full-age-span"}


@app.middleware("http")
async def prevent_stale_local_assets(request: Request, call_next):
    """Apply development-safe asset headers and production API caching."""
    response = await call_next(request)
    hosted = bool(os.environ.get("VERCEL"))
    if not hosted and request.url.path in {
        "/", "/index.html", "/app.js", "/alignment.js", "/telemetry-model.js", "/config.js", "/styles.css", "/design-system.css", "/apple-ui.css"
    }:
        response.headers["Cache-Control"] = "no-store, max-age=0"
    elif hosted and request.url.path in {"/", "/index.html"}:
        response.headers["Cache-Control"] = "public, max-age=60, s-maxage=300, stale-while-revalidate=86400"
    elif hosted and request.url.path.endswith((".js", ".css", ".svg")):
        response.headers["Cache-Control"] = "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800"
    elif request.url.path.startswith("/api/") and response.status_code == 200:
        # URLs contain season, session, driver and lap identity. Cache complete
        # responses at the browser/CDN edge so reopening a comparison avoids a
        # Vercel cold start. Incomplete current-season position streams set
        # their own no-store header inside the endpoint and are left untouched.
        if "cache-control" not in response.headers:
            current_year = str(datetime.now().year)
            is_current = request.query_params.get("year") == current_year
            max_age = 120 if is_current else 86400
            stale = 900 if is_current else 604800
            response.headers["Cache-Control"] = (
                f"public, max-age={max_age}, s-maxage={max_age}, stale-while-revalidate={stale}"
            )
        response.headers.setdefault("Vary", "Origin, Accept-Encoding")
    return response


@app.exception_handler(Exception)
async def unexpected_error(request: Request, error: Exception):
    """Keep API failures parseable and leave the full traceback in Uvicorn."""
    request_id = uuid4().hex
    logger.exception("Unhandled error %s serving %s", request_id, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "request_id": request_id},
        headers={"X-Request-ID": request_id, "Cache-Control": "no-store"},
    )


def seconds(value: Any) -> float | None:
    if value is None:
        return None
    try:
        if hasattr(value, "total_seconds"):
            value = value.total_seconds()
        value = float(value)
        return value if math.isfinite(value) else None
    except (TypeError, ValueError):
        return None


def integer(value: Any, default: int = 0) -> int:
    try:
        value = float(value)
        return int(value) if math.isfinite(value) else default
    except (TypeError, ValueError):
        return default


def pit_lap_number(value: Any) -> int | None:
    value = seconds(value)
    return int(value) if value is not None and value >= 1 else None


def openf1_pit_visits(pits: list[dict], drivers: list[dict], stints=None) -> list[dict]:
    """Keep entry-to-exit and stationary timing as distinct measurements."""
    identities = {str(d.get('driver_number')): d for d in drivers}
    visits = []
    for pit in pits:
        identity = identities.get(str(pit.get('driver_number')), {})
        lane = seconds(pit.get('lane_duration'))
        if lane is None:
            lane = seconds(pit.get('pit_duration'))  # deprecated alias for lane, not stop
        stop = seconds(pit.get('stop_duration'))
        lap = pit_lap_number(pit.get('lap_number'))
        if lap is None:
            continue
        if lane is not None and not 5 <= lane <= 300:
            lane=None
        if stop is None or not 0 < stop <= (lane+1 if lane is not None else 300):
            stop = None
        if lane is None and stop is None:
            continue
        visits.append({
            'driver': str(identity.get('name_acronym') or ''),
            'driver_number': str(pit.get('driver_number')),
            'team': str(identity.get('team_name') or ''),
            'lap': lap,
            'lane_duration': round(lane, 3) if lane is not None else None,
            'stop_duration': round(stop, 3) if stop is not None else None,
            'visit_type': 'service' if stop is not None else 'unknown',
            'visit_evidence': 'supplied stationary timing' if stop is not None else 'no service evidence supplied',
        })
        if stop is None:
            changed = [s for s in (stints or []) if str(s.get('driver_number')) == str(pit.get('driver_number'))
                       and pit_lap_number(s.get('lap_start')) == lap+1
                       and pit_lap_number(s.get('stint_number')) not in (None, 1)]
            if changed:
                visits[-1].update(visit_type='service', visit_evidence='supplied new tyre stint')
    return sorted(visits, key=lambda v: (v['lap'], v['driver_number']))


def mark_penalty_stops(visits: list[dict], messages: list[dict]) -> list[dict]:
    """Keep penalties served at a stop out of the pit-crew comparison.

    A time penalty taken in the pit box adds its seconds to the stationary
    time before work can start, and a stop-and-go has no service at all. The
    first stop after the race-control notice that lasts at least the penalty
    is marked; it stays visible as evidence with its reason.
    """
    import re
    pending = {}
    notices = sorted((m for m in messages or () if m.get('message')), key=lambda m: (m.get('lap_number') or 0, m.get('date') or ''))
    for m in notices:
        text = str(m['message']).upper()
        car = re.search(r'FOR CAR (\d+)', text)
        if not car or 'PENALTY' not in text or 'NO FURTHER' in text or 'REVIEW' in text:
            continue
        timed = re.search(r'(\d+) SECOND TIME PENALTY', text)
        kind = 'stop-and-go' if 'STOP AND GO' in text else 'time' if timed else None
        if kind:
            pending.setdefault(car.group(1), []).append({'lap': m.get('lap_number') or 0, 'kind': kind,
                                                         'seconds': int(timed.group(1)) if timed else 10})
    for visit in sorted(visits, key=lambda v: v['lap']):
        queue = pending.get(str(visit['driver_number'])) or []
        due = next((p for p in queue if p['lap'] <= visit['lap']), None)
        stop = visit.get('stop_duration')
        if due and stop is not None and stop >= due['seconds']:
            queue.remove(due)
            visit.update(visit_type='penalty-served',
                         visit_evidence=f"{due['seconds']} s {'stop-and-go' if due['kind'] == 'stop-and-go' else 'time penalty'} served at this stop (race control)")
    return visits


class _DhlPitTable(HTMLParser):
    """Read the published DHL timing table without depending on page styling."""
    def __init__(self):
        super().__init__()
        self.rows: list[list[str]] = []
        self.row: list[str] | None = None
        self.cell: list[str] | None = None

    def handle_starttag(self, tag, attrs):
        if tag == 'tr':
            self.row = []
        elif tag == 'td' and self.row is not None:
            self.cell = []

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if tag == 'td' and self.cell is not None and self.row is not None:
            self.row.append(unescape(''.join(self.cell)).strip())
            self.cell = None
        elif tag == 'tr' and self.row is not None:
            if len(self.row) >= 5:
                self.rows.append(self.row)
            self.row = None


def _pit_name(value: Any) -> str:
    normalized = unicodedata.normalize('NFKD', str(value or ''))
    return ''.join(c for c in normalized.casefold() if c.isalnum())


def _dhl_json(url: str) -> dict:
    request = URLRequest(url, headers={'Accept-Encoding': 'gzip', 'User-Agent': 'euV2-data/1.0'})
    with urlopen(request, timeout=12) as result:
        body = result.read()
        if result.headers.get('Content-Encoding', '').lower() == 'gzip':
            body = gzip.decompress(body)
    return json.loads(body.decode('utf-8'))


@lru_cache(maxsize=2)
def _dhl_2026_events() -> list[dict]:
    return _dhl_json('https://inmotion.dhl/api/f1-award-element-data/7375')['data']['chart']['events']


def dhl_2026_pit_stops(session: dict) -> list[dict]:
    """Get actual stationary timings from DHL's public 2026 event table."""
    race_date = datetime.fromisoformat(str(session['date_start']).replace('Z', '+00:00')).date()
    candidates = [event for event in _dhl_2026_events()
                  if datetime.fromisoformat(event['date']['date'].split(' ')[0]).date() == race_date]
    if len(candidates) != 1:
        return []
    event_id = int(candidates[0]['id'])
    payload = _dhl_json(f'https://inmotion.dhl/api/f1-award-element-data/7373?event={event_id}')
    parser = _DhlPitTable()
    parser.feed(payload.get('htmlList', {}).get('table', ''))
    stops = []
    for cells in parser.rows:
        try:
            duration = float(cells[3])
            lap = int(cells[4])
        except (ValueError, IndexError):
            continue
        if 0 < duration <= 300 and lap >= 1:
            stops.append({'team': cells[1], 'last_name': cells[2], 'lap': lap,
                          'stop_duration': round(duration, 3)})
    return stops


def merge_dhl_pit_stops(visits: list[dict], drivers: list[dict], stops: list[dict], include_unmatched=False) -> int:
    """Match a DHL box stop only to the same driver and in-lap."""
    identities = {_pit_name(d.get('last_name')): d for d in drivers if d.get('last_name')}
    indexed = {(v['driver_number'], v['lap']): v for v in visits}
    matched = 0
    for stop in stops:
        identity = identities.get(_pit_name(stop['last_name']))
        number = str(identity['driver_number']) if identity else None
        visit = indexed.get((number, stop['lap'])) if number else None
        if visit is None and include_unmatched and identity and identity.get('name_acronym'):
            # Published box timing is useful even when entry/exit packets are
            # missing. Never infer a pit-lane duration from stationary timing.
            visit = {'driver_number':number,'driver':identity['name_acronym'],
                     'team':identity.get('team_name') or stop['team'],'lap':stop['lap'],
                     'lane_duration':None,'stop_duration':None}
            visits.append(visit);indexed[(number,stop['lap'])]=visit
        if (visit is not None and visit['stop_duration'] is None
                and 0 < stop['stop_duration'] <= (visit['lane_duration'] + 1 if visit['lane_duration'] is not None else 300)):
            visit['stop_duration'] = stop['stop_duration']
            visit.update(visit_type='service', visit_evidence='DHL stationary timing')
            matched += 1
    return matched


def pit_timing_payload(gp, year, source, visits, drivers, date=None, supplement_status=None):
    stationary = sum(v.get('stop_duration') is not None for v in visits)
    return {'event':gp,'year':year,'source':source,'date':date,'visits':visits,
            'entrants':[{'driver':d.get('name_acronym') or '',
                         'driver_number':str(d.get('driver_number')),
                         'team':d.get('team_name') or ''} for d in drivers],
            'timing_coverage':{'visits':len(visits),'stationary_timed':stationary,
                              'lane_timed':sum(v.get('lane_duration') is not None for v in visits)},
            'stationary_status':'complete' if visits and stationary==len(visits) else 'partial' if stationary else 'unavailable',
            'stationary_supplement_status':supplement_status}


def fastf1_pit_visits(laps: Any) -> list[dict]:
    """Pair a race in-lap with its following out-lap for pit-lane duration."""
    by_driver = {}
    for _, row in laps.iterrows():
        lap = pit_lap_number(row.get('LapNumber'))
        if lap is not None:
            by_driver.setdefault(str(row.get('DriverNumber')), []).append((lap, row))
    visits = []
    for driver_number, sequence in by_driver.items():
        sequence.sort(key=lambda pair: pair[0])
        for i, (lap, row) in enumerate(sequence[:-1]):
            pit_in = seconds(row.get('PitInTime'))
            if pit_in is None:
                continue
            next_lap, next_row = sequence[i + 1]
            pit_out = seconds(next_row.get('PitOutTime'))
            lane = pit_out - pit_in if pit_out is not None else None
            if next_lap - lap not in (1, 2) or lane is None or not 5 <= lane <= 300:
                continue
            visits.append({
                'driver': str(row.get('Driver') or ''),
                'driver_number': driver_number,
                'team': str(row.get('Team') or ''),
                'lap': lap,
                'lane_duration': round(lane, 3),
                'stop_duration': None,
                'visit_type': 'service' if (seconds(next_row.get('Stint')) is not None
                    and seconds(row.get('Stint')) is not None
                    and seconds(next_row.get('Stint')) > seconds(row.get('Stint'))
                    and seconds(next_row.get('TyreLife')) is not None
                    and seconds(row.get('TyreLife')) is not None
                    and seconds(next_row.get('TyreLife')) < seconds(row.get('TyreLife'))) else 'unknown',
                'visit_evidence': 'tyre stint and age reset' if (seconds(next_row.get('TyreLife')) is not None
                    and seconds(row.get('TyreLife')) is not None
                    and seconds(next_row.get('TyreLife')) < seconds(row.get('TyreLife'))) else 'no confirmed service evidence',
            })
    return sorted(visits, key=lambda v: (v['lap'], v['driver_number']))


def utc_timestamp(value: Any) -> str | None:
    if value is None or pd.isna(value):
        return None
    timestamp = pd.Timestamp(value)
    return (timestamp.tz_localize("UTC") if timestamp.tzinfo is None else timestamp.tz_convert("UTC")).isoformat()


def prepare_weather_lookup(weather_data: Any):
    if weather_data is None or getattr(weather_data, "empty", True):
        return ([], [])
    records = sorted(((seconds(row.get("Time")), row) for row in weather_data.to_dict("records")
                     if seconds(row.get("Time")) is not None), key=lambda item: item[0])
    return ([item[0] for item in records], [item[1] for item in records])


def nearest_weather_conditions(weather_data: Any, target_seconds: float | None) -> dict[str, Any] | None:
    """Return the closest published weather sample to a lap midpoint."""
    if target_seconds is None or weather_data is None:
        return None
    times, rows = weather_data if isinstance(weather_data, tuple) else prepare_weather_lookup(weather_data)
    if not times:
        return None
    index = bisect_left(times, target_seconds)
    candidates = [i for i in (index-1, index) if 0 <= i < len(times)]
    row = rows[min(candidates, key=lambda i: abs(times[i]-target_seconds))]
    result = {
        "air_temperature": seconds(row.get("AirTemp")),
        "track_temperature": seconds(row.get("TrackTemp")),
        "wind_speed": seconds(row.get("WindSpeed")),
        "wind_direction": seconds(row.get("WindDirection")),
        "rainfall": None if pd.isna(row.get("Rainfall")) else bool(row.get("Rainfall")),
    }
    return result if any(value is not None for value in result.values()) else None


def prepared_cache_path(namespace: str, *parts: Any) -> Path:
    identity = json.dumps(
        [PREPARED_CACHE_VERSION, namespace, *parts],
        separators=(",", ":"),
        default=str,
    )
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()
    return PREPARED_CACHE / f"{namespace}-{digest}.json.gz"


_calendar_memo: dict[int, tuple[float, list]] = {}


def _event_settled(year: int, parts: tuple) -> bool:
    """True when a part names an event whose race day was over two days ago."""
    names = {str(p) for p in parts if isinstance(p, str)}
    if not names:
        return False
    memo = _calendar_memo.get(year)
    if memo is None or time.time()-memo[0] > 3600:
        try:
            memo = (time.time(), event_calendar(year))
        except Exception:
            return False
        _calendar_memo[year] = memo
    for event in memo[1]:
        if event.get("name") in names and event.get("date"):
            try:
                day = datetime.fromisoformat(str(event["date"])[:10]).date()
            except ValueError:
                return False
            return (datetime.now(timezone.utc).date()-day).days >= 2
    return False


def read_prepared_cache(namespace: str, year: int, *parts: Any) -> Any | None:
    path = prepared_cache_path(namespace, year, *parts)
    if not path.exists():
        return None
    # Upstream classifications and lap feeds can be reprocessed after a
    # session (and, occasionally, after a season). Current data refreshes
    # quickly; historical session/telemetry payloads get a weekly revalidation
    # instead of being treated as immutable forever.
    age = time.time() - path.stat().st_mtime
    # A current-season event that finished days ago is as final as last
    # season's; only events still in progress (or just finished, while
    # results can be amended) refresh every ten minutes.
    if year >= datetime.now().year and age > 600 and not _event_settled(year, parts):
        return None
    if namespace in {"session", "telemetry", "openf1-performance-v1"} and age > 7 * 86400:
        return None
    try:
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        path.unlink(missing_ok=True)
        return None


def write_prepared_cache(namespace: str, year: int, payload: Any, *parts: Any) -> None:
    path = prepared_cache_path(namespace, year, *parts)
    # Multiple visible traces can request the same cold lap concurrently. Give
    # every writer its own staging file so one response cannot replace or
    # delete another response's open .tmp file on Windows.
    temporary = path.with_name(f"{path.name}.{uuid4().hex}.tmp")
    try:
        with gzip.open(temporary, "wt", encoding="utf-8", compresslevel=5) as handle:
            json.dump(payload, handle, separators=(",", ":"), allow_nan=False)
        temporary.replace(path)
    except (OSError, TypeError, ValueError) as error:
        logger.debug("Could not persist %s cache: %s", namespace, error)
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass


# Measured free-tier limits (October 2026): about 3 requests per second in a
# burst, and HTTP 429 after roughly 45 requests inside a minute. Stay under
# both so long loads run at a steady rate instead of stalling on backoff.
OPENF1_MIN_INTERVAL_S = 0.35
OPENF1_PER_MINUTE = 50
OPENF1_ATTEMPTS = 5
_openf1_lock = threading.Lock()
_openf1_next = [0.]
_openf1_recent: deque[float] = deque()


def _openf1_wait() -> None:
    """Block until one more request fits both limits; call with the lock held."""
    now = time.monotonic()
    while _openf1_recent and now-_openf1_recent[0] >= 60:
        _openf1_recent.popleft()
    wait = _openf1_next[0]-now
    if len(_openf1_recent) >= OPENF1_PER_MINUTE:
        wait = max(wait, 60-(now-_openf1_recent[0]))
    if wait > 0:
        time.sleep(wait)
    now = time.monotonic()
    _openf1_recent.append(now)
    _openf1_next[0] = now+OPENF1_MIN_INTERVAL_S
_openf1_session_ends: dict[Any, str] = {}
_openf1_meta: dict[str, tuple[float, Any]] = {}


def openf1_url(endpoint: str, **params: Any) -> str:
    from urllib.parse import quote
    parts = []
    for key, value in params.items():
        if value is None:
            continue
        if key.endswith(">=") or key.endswith("<=") or key.endswith(">") or key.endswith("<"):
            parts.append(f"{key}{quote(str(value))}")
        else:
            parts.append(f"{key}={quote(str(value))}")
    return f"{OPENF1}/{endpoint}?{'&'.join(parts)}"


def openf1_cache_path(url: str) -> Path:
    """Where a raw OpenF1 response is kept: RAW_ROOT, or the old in-repo folder
    when the file is only there (it is read in place, never copied)."""
    name = hashlib.sha256(url.encode()).hexdigest()+".json.gz"
    path = RAW_ROOT / name
    legacy = PREPARED_CACHE / "openf1" / name
    return legacy if not path.exists() and legacy.exists() else path


# Which meeting and session a name means is looked up before any stored data can be found, so these two lists are kept on disk
# beside the raw responses (same hashed file name) and used whenever OpenF1 cannot answer: during a live session it refuses
# everyone without a key, past sessions included (HTTP 401), and it can be down or rate limited. Live is still tried first, so a
# new session appears as soon as OpenF1 lists it.
_OPENF1_METADATA = ("sessions", "meetings")
_OPENF1_OFFLINE_RETRY_S = 60.
_openf1_offline_until = [0.]


def _write_raw(path: Path, rows: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{uuid4().hex}.tmp")
    try:
        with gzip.open(temporary, "wt", encoding="utf-8", compresslevel=5) as handle:
            json.dump(rows, handle, separators=(",", ":"))
        temporary.replace(path)
    except OSError:
        temporary.unlink(missing_ok=True)


def _saved_openf1_metadata(url: str) -> list[dict[str, Any]] | None:
    path = openf1_cache_path(url)
    try:
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            rows = json.load(handle)
    except (OSError, ValueError):
        return None
    return rows if isinstance(rows, list) and rows else None


def _remember_settled_sessions(rows: Any) -> None:
    """Session end times from a sessions list, so finished sessions are recognised as settled without asking OpenF1 again."""
    known = _settled_session_ends()
    for item in rows if isinstance(rows, list) else []:
        key, end = item.get("session_key"), item.get("date_end")
        if key is None or not end or str(key) in known:
            continue
        try:
            finished = datetime.fromisoformat(str(end).replace("Z", "+00:00"))
        except ValueError:
            continue
        if finished.tzinfo is None:
            finished = finished.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc)-finished > timedelta(hours=6):
            _remember_settled_session(key, end)


def _openf1_metadata_rows(endpoint: str, url: str) -> list[dict[str, Any]]:
    hit = _openf1_meta.get(url)
    if hit and time.monotonic()-hit[0] < 600:
        return hit[1]
    if time.monotonic() < _openf1_offline_until[0]:
        saved = _saved_openf1_metadata(url)
        if saved is not None:
            return saved
    try:
        result = _openf1_fetch(url)
    except (OSError, ValueError) as exc:
        saved = _saved_openf1_metadata(url)
        if saved is None:
            raise
        _openf1_offline_until[0] = time.monotonic()+_OPENF1_OFFLINE_RETRY_S
        print(f"OpenF1 unavailable ({exc}); using the saved {endpoint} list for {url.split('?', 1)[-1]}", flush=True)
        return saved
    _openf1_offline_until[0] = 0.
    if result:
        _openf1_meta[url] = (time.monotonic(), result)
        _write_raw(openf1_cache_path(url), result)
        if endpoint == "sessions":
            for item in result if isinstance(result, list) else []:
                if item.get("session_key") is not None and item.get("date_end"):
                    _openf1_session_ends[item["session_key"]] = item["date_end"]
            _remember_settled_sessions(result)
    return result


def openf1(endpoint: str, **params: Any) -> list[dict[str, Any]]:
    valid_params = {key: value for key, value in params.items() if value is not None}
    url = openf1_url(endpoint, **valid_params)
    if endpoint in _OPENF1_METADATA:
        return _openf1_metadata_rows(endpoint, url)
    session_key = valid_params.get("session_key")
    settled = session_key is not None and _openf1_session_settled(session_key)
    cache_path = openf1_cache_path(url)
    if settled and cache_path.exists():
        try:
            with gzip.open(cache_path, "rt", encoding="utf-8") as handle:
                return json.load(handle)
        except (OSError, ValueError):
            cache_path.unlink(missing_ok=True)
    result = _openf1_fetch(url)
    if settled and result:
        _write_raw(cache_path, result)
    return result


OPENF1_WINDOW_S = 300


def _openf1_epoch(value: Any) -> float:
    return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()


@lru_cache(maxsize=8)
def openf1_session_stream(endpoint: str, session_key: Any, driver_number: Any) -> tuple[list[float], list[dict[str, Any]]] | None:
    """A driver's whole-session stream already on disk, sorted by time.

    Written by scripts/mirror-openf1.py or by an earlier full-race load (the
    same URL), so a lap is a slice of it instead of an OpenF1 request.
    """
    path = openf1_cache_path(openf1_url(endpoint, session_key=session_key, driver_number=driver_number))
    if not path.exists():
        return None
    try:
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            rows = json.load(handle)
        rows = sorted((row for row in rows if row.get("date")), key=lambda row: _openf1_epoch(row["date"]))
        return [_openf1_epoch(row["date"]) for row in rows], rows
    except (OSError, ValueError, TypeError):
        return None


def openf1_window_points(endpoint: str, session_key: Any, driver_number: Any,
                         window_start: datetime, window_end: datetime) -> list[dict[str, Any]]:
    """Points for one driver from the fixed all-driver windows covering a lap."""
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    start = window_start if window_start.tzinfo else window_start.replace(tzinfo=timezone.utc)
    end = window_end if window_end.tzinfo else window_end.replace(tzinfo=timezone.utc)
    stream = openf1_session_stream(endpoint, session_key, str(driver_number))
    if stream is not None:
        times, rows = stream
        return rows[bisect_left(times, start.timestamp()):bisect_right(times, end.timestamp())]
    first = int((start-epoch).total_seconds()//OPENF1_WINDOW_S)
    last = int((end-epoch).total_seconds()//OPENF1_WINDOW_S)
    points = []
    for bucket in range(first, last+1):
        lo = epoch+timedelta(seconds=bucket*OPENF1_WINDOW_S)
        hi = lo+timedelta(seconds=OPENF1_WINDOW_S)
        try:
            rows = openf1(endpoint, session_key=session_key,
                          **{"date>=": lo.strftime("%Y-%m-%dT%H:%M:%S"), "date<": hi.strftime("%Y-%m-%dT%H:%M:%S")})
        except Exception:
            return []
        points += [row for row in rows if str(row.get("driver_number")) == str(driver_number)]
    return points


def _openf1_session_settled(session_key: Any) -> bool:
    """Final data: the session ended more than six hours ago.

    Finished-session telemetry never changes, so it is kept on disk across
    restarts and code changes instead of being downloaded again.
    """
    end = _openf1_session_ends.get(session_key) or _settled_session_ends().get(str(session_key))
    if end is None:
        try:
            for item in _openf1_fetch(f"{OPENF1}/sessions?session_key={session_key}"):
                if item.get("date_end"):
                    _openf1_session_ends[item["session_key"]] = end = item["date_end"]
        except Exception:
            return False
    if not end:
        return False
    try:
        finished = datetime.fromisoformat(str(end).replace("Z", "+00:00"))
    except ValueError:
        return False
    if finished.tzinfo is None:
        finished = finished.replace(tzinfo=timezone.utc)
    settled = datetime.now(timezone.utc)-finished > timedelta(hours=6)
    if settled and str(session_key) not in _settled_session_ends():
        _remember_settled_session(session_key, end)
    return settled


_settled_ends_lock = Lock()


def _settled_session_ends_path() -> Path:
    return RAW_ROOT / "settled-sessions.json"


@lru_cache(maxsize=1)
def _settled_session_ends() -> dict[str, str]:
    """Settled sessions never reopen, so their end times are kept on disk."""
    try:
        return json.loads(_settled_session_ends_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _remember_settled_session(session_key: Any, end: str) -> None:
    with _settled_ends_lock:
        ends = _settled_session_ends()
        ends[str(session_key)] = str(end)
        path = _settled_session_ends_path()
        path.parent.mkdir(exist_ok=True)
        temporary = path.with_name(f"{path.name}.{uuid4().hex}.tmp")
        try:
            temporary.write_text(json.dumps(ends, sort_keys=True), encoding="utf-8")
            temporary.replace(path)
        except OSError:
            temporary.unlink(missing_ok=True)


def _openf1_fetch(url: str) -> Any:
    # OpenF1 rate-limits bursts (HTTP 429). Parallel lap loads used to turn
    # each 429 into a missing driver that only a manual retry recovered, so
    # requests are paced process-wide and transient errors are retried.
    for attempt in range(OPENF1_ATTEMPTS):
        with _openf1_lock:
            _openf1_wait()
        request = URLRequest(url, headers={"Accept-Encoding": "gzip", "User-Agent": "euV2-data/1.0"})
        try:
            with urlopen(request, timeout=20) as response:
                body = response.read()
                if response.headers.get("Content-Encoding", "").lower() == "gzip":
                    body = gzip.decompress(body)
                return json.loads(body.decode("utf-8"))
        except HTTPError as exc:
            if exc.code not in (429, 502, 503, 504) or attempt+1 == OPENF1_ATTEMPTS:
                raise
            retry = exc.headers.get("Retry-After") if exc.headers else None
            try:
                delay = min(20., float(retry)) if retry else 1.5*2**attempt
            except ValueError:
                delay = 1.5*2**attempt
            with _openf1_lock:
                _openf1_next[0] = max(_openf1_next[0], time.monotonic()+delay)


def _normalised_name(value: Any) -> str:
    return " ".join(
        str(value or "").casefold().replace("grand prix", "").replace("great britain", "british").split()
    )


def exact_fastf1_event(
    year: int,
    gp: str,
    *,
    backend: str | None = None,
    location: str = "",
):
    """Resolve an event without FastF1's cross-event fuzzy fallback."""
    schedule = fastf1_runtime().get_event_schedule(
        year, include_testing=False, backend=backend
    )
    wanted = str(gp).strip().casefold()
    matches = schedule[
        schedule["EventName"].astype(str).str.strip().str.casefold() == wanted
    ]
    if len(matches) == 1:
        return matches.iloc[0]

    # Venue matching is only used for circuit metadata across renamed races.
    wanted_location = str(location).strip().casefold()
    if wanted_location and "Location" in schedule:
        matches = schedule[
            schedule["Location"].astype(str).str.strip().str.casefold()
            == wanted_location
        ]
        if len(matches) == 1:
            return matches.iloc[0]
    raise ValueError(f"'{gp}' is not an exact event on the {year} calendar")


def _openf1_meeting(year: int, gp: str, meetings: list[dict[str, Any]]) -> dict[str, Any] | None:
    wanted = _normalised_name(gp)
    direct = [item for item in meetings if _normalised_name(item.get("meeting_name")) == wanted]
    if len(direct) == 1:
        return direct[0]

    # New/renamed events can use different names between providers. Match the
    # exact venue/country and race-week date rather than using substrings.
    try:
        event = exact_fastf1_event(year, gp, backend="fastf1")
        location = str(event.get("Location") or "").strip().casefold()
        country = str(event.get("Country") or "").strip().casefold()
        event_date = datetime.fromisoformat(str(event.get("EventDate"))[:10]).date()
    except Exception:
        return None

    candidates = []
    for item in meetings:
        item_location = str(item.get("location") or "").strip().casefold()
        item_country = str(item.get("country_name") or "").strip().casefold()
        if location and item_location and location != item_location:
            continue
        if country and item_country and country != item_country:
            continue
        try:
            meeting_date = datetime.fromisoformat(
                str(item.get("date_start") or "").replace("Z", "+00:00")
            ).date()
            distance = abs((meeting_date - event_date).days)
        except ValueError:
            distance = 99
        if distance <= 3:
            candidates.append((distance, item))
    candidates.sort(key=lambda row: row[0])
    if not candidates or (len(candidates) > 1 and candidates[0][0] == candidates[1][0]):
        return None
    return candidates[0][1]


_openf1_metadata_cache = {}
_openf1_metadata_lock = Lock()


def openf1_metadata(endpoint, **params):
    """Share successful calendar lookups; never cache a throttled lookup as absent."""
    key = (endpoint, tuple(sorted(params.items())))
    with _openf1_metadata_lock:
        cached = _openf1_metadata_cache.get(key)
        if cached and time.monotonic() - cached[0] < 300:
            return cached[1]
        rows = openf1_performance_feed(endpoint, **params)
        if rows:
            if len(_openf1_metadata_cache) >= 64:
                _openf1_metadata_cache.pop(next(iter(_openf1_metadata_cache)))
            _openf1_metadata_cache[key] = (time.monotonic(), rows)
        return rows


def openf1_session(year: int, gp: str, session_name: str) -> dict[str, Any] | None:
    try:
        meetings = openf1_metadata("meetings", year=year)
        meeting = _openf1_meeting(year, gp, meetings)
        if meeting is None or meeting.get("meeting_key") is None:
            return None
        sessions = openf1_metadata("sessions", year=year, meeting_key=meeting["meeting_key"])
        wanted_session = session_name.lower().strip()
        names = {'q': {'qualifying'}, 'r': {'race'},
                 'fp1': {'practice 1'}, 'fp2': {'practice 2'}, 'fp3': {'practice 3'},
                 's': {'sprint'}, 'sq': {'sprint qualifying', 'sprint shootout'}}
        wanted_names = names.get(wanted_session, {wanted_session})
        matches = [item for item in sessions
                   if item.get('session_name', '').lower().strip() in wanted_names
                   and not item.get('is_cancelled', False)]
        if len(matches) == 1:
            return matches[0]
    except HTTPError:
        raise
    except Exception as e:
        logger.error("Error in openf1_session: %s", e)
        return None
    return None


def position_geometry_quality(samples):
    valid = [p for p in samples if all(seconds(p.get(k)) is not None
                                     for k in ('X', 'Y', 'ElapsedSeconds'))]
    coverage = len(valid) / max(1, len(samples))
    duration = seconds(samples[-1].get('ElapsedSeconds')) if samples else None
    complete = bool(len(valid) >= 2 and coverage >= .98 and duration is not None
                    and 0 <= valid[0]['ElapsedSeconds'] <= .5
                    and duration - valid[-1]['ElapsedSeconds'] <= .5
                    and all(0 < b['ElapsedSeconds'] - a['ElapsedSeconds'] <= 1.5
                            for a, b in zip(valid, valid[1:])))
    return coverage, complete


def join_openf1_positions(car, location):
    """Nearest position within 400 ms; ties prefer the earlier packet."""
    dated = sorted((datetime.fromisoformat(p['date'].replace('Z', '+00:00')), i, p)
                   for i, p in enumerate(location))
    if not dated:
        return car
    times = [row[0] for row in dated]
    result = []
    for point in car:
        timestamp = datetime.fromisoformat(point['date'].replace('Z', '+00:00'))
        # Right insertion keeps the last packet at an identical timestamp,
        # matching merge_asof's backward/exact-match preference.
        index = bisect_right(times, timestamp)
        candidates = dated[max(0, index-1):min(len(dated), index+1)]
        nearest = min(candidates, key=lambda row: (abs((row[0]-timestamp).total_seconds()), row[0]))
        position = nearest[2] if abs((nearest[0]-timestamp).total_seconds()) <= .4 else {}
        result.append({**point, 'x': position.get('x'), 'y': position.get('y'),
                       'position_interval_s':abs((nearest[0]-timestamp).total_seconds())*2 if position else None})
    return result


@lru_cache(maxsize=256)
def _openf1_lap_telemetry(
    year: int,
    gp: str,
    session_name: str,
    driver_number: str,
    lap_number: int,
    freshness_bucket: int,
    session_key: int | None = None,
    lap_start: str | None = None,
    lap_time: float | None = None,
    next_start: str | None = None,
    streams: dict[str, list[dict[str, Any]]] | None = None,
) -> list[dict[str, Any]]:
    if session_key is None:
        session = openf1_session(year, gp, session_name)
        if not session:
            return []
        session_key = session["session_key"]
    if lap_start and lap_time is not None:
        driver_laps = [{"lap_number":lap_number,"date_start":lap_start,"lap_duration":lap_time}]
        if next_start:
            driver_laps.append({"lap_number":lap_number+1,"date_start":next_start})
    else:
        # One cached lap list per session instead of one request per driver.
        driver_laps = [item for item in openf1("laps", session_key=session_key)
                       if str(item.get("driver_number")) == str(driver_number)
                       and lap_number <= integer(item.get("lap_number"), -1) <= lap_number+1]
    matching_laps = [
        item for item in driver_laps
        if integer(item.get("lap_number"), -1) == lap_number
    ]
    if not matching_laps:
        return []
    lap_info = matching_laps[0]
    lap_duration = seconds(lap_info.get("lap_duration"))
    # Pit-out records occasionally contain the time since an earlier timing
    # event rather than a lap duration (for example an 802 s "lap"). They are
    # useful in the run list, but must never enter a lap comparison.
    if (lap_info.get("is_pit_out_lap") is True or not lap_info.get("date_start")
            or lap_duration is None or not 20 < lap_duration < 300):
        return []
    stated_start_dt = datetime.fromisoformat(lap_info["date_start"].replace("Z", "+00:00"))
    start_dt = stated_start_dt
    finish_dt = start_dt + timedelta(seconds=lap_duration)

    # The next lap's start is the selected lap's actual finish-line event.
    # OpenF1 labels date_start as approximate, while lap_duration is official;
    # anchoring to that shared boundary and subtracting the official duration
    # produces a more internally consistent start and finish. Reject implausible
    # corrections so incomplete/reordered live timing cannot shift the trace.
    next_lap = next((
        item for item in driver_laps
        if integer(item.get("lap_number"), -1) == lap_number + 1 and item.get("date_start")
    ), None)
    if next_lap is not None:
        next_start_dt = datetime.fromisoformat(next_lap["date_start"].replace("Z", "+00:00"))
        corrected_start_dt = next_start_dt - timedelta(seconds=lap_duration)
        if abs((corrected_start_dt - stated_start_dt).total_seconds()) <= 1.0:
            start_dt = corrected_start_dt
            finish_dt = next_start_dt
    # Car data is only sampled at roughly 3.7 Hz. Request a sample on both
    # sides of each timing-line crossing so the lap can be anchored at the
    # crossing itself instead of at the first (late) sample inside the lap.
    window_start = start_dt - timedelta(seconds=1.0)
    window_end = finish_dt + timedelta(seconds=1.0)
    start_str = window_start.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3]
    end_str = window_end.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3]

    def lap_stream(endpoint: str) -> list[dict[str, Any]]:
        if streams is not None:
            # Full-race callers retrieve each driver/channel once. Reuse the
            # unchanged lap-boundary and native-position joining logic below.
            return [point for point in streams.get(endpoint, []) if window_start
                    <= datetime.fromisoformat(point['date'].replace('Z', '+00:00')) <= window_end]
        # One all-driver request per fixed 5-minute window serves every lap
        # set in it (a qualifying run is a few minutes), and caches on disk.
        points = openf1_window_points(endpoint, session_key, driver_number, window_start, window_end)
        if not points:
            points = openf1(
                endpoint,
                session_key=session_key,
                driver_number=driver_number,
                **{"date>=": start_str, "date<=": end_str},
            )
        # Fresh sessions occasionally expose data through the session/driver
        # query before the date-range index catches up.
        if not points:
            points = openf1(endpoint, session_key=session_key, driver_number=driver_number)
        # Some fresh indexes accept the date filter but return the entire
        # session stream, so enforce the official lap window locally.
        return [point for point in points if window_start
                <= datetime.fromisoformat(point["date"].replace("Z", "+00:00"))
                <= window_end]

    # Car and position are independent streams. Fetching both concurrently
    # removes one full OpenF1 round trip from each cold telemetry request.
    pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="openf1")
    try:
        car_future = pool.submit(lap_stream, "car_data")
        location_future = pool.submit(lap_stream, "location")
        car = car_future.result()
        try:
            # The map is optional for the speed trace. A late location feed
            # must not consume its entire HTTP timeout before car data displays.
            location = location_future.result(timeout=2)
        except Exception as error:
            logger.debug("OpenF1 position data unavailable: %s", error)
            location = []
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    if not car:
        return []
    # OpenF1 publishes vehicle location separately from car channels. Joining
    # it here gives the mini-sector map a real circuit shape even when FastF1's
    # car-data archive is unavailable for a recent weekend.
    try:
        if location:
            car = join_openf1_positions(car, location)
    except Exception as error:
        logger.debug("OpenF1 position data unavailable: %s", error)

    car.sort(key=lambda item: item["date"])

    def boundary_point(boundary: datetime) -> dict[str, Any] | None:
        """Interpolate continuous channels at an official timing boundary."""
        before = None
        after = None
        for item in car:
            item_time = datetime.fromisoformat(item["date"].replace('Z', '+00:00'))
            if item_time <= boundary:
                before = item
            if item_time >= boundary:
                after = item
                break
        if before is None and after is None:
            return None
        if before is None or after is None:
            return None

        before_time = datetime.fromisoformat(before["date"].replace('Z', '+00:00'))
        after_time = datetime.fromisoformat(after["date"].replace('Z', '+00:00'))
        span = (after_time - before_time).total_seconds()
        if span>1.5:
            return None
        ratio = 0.0 if span <= 0 else (boundary - before_time).total_seconds() / span
        ratio = max(0.0, min(1.0, ratio))
        result = dict(before)
        result["date"] = boundary.isoformat().replace("+00:00", "Z")
        result['boundary_interpolated'] = span>0 and 0<ratio<1
        result['source_interval_s'] = span

        # These are instantaneous numeric channels, so time interpolation is
        # the least-biased estimate at the line. State channels remain nearest
        # neighbour because fractional gears, brake flags and DRS states are
        # not physically meaningful.
        for field in ("speed", "throttle", "rpm", "x", "y"):
            left = seconds(before.get(field))
            right = seconds(after.get(field))
            if left is not None and right is not None:
                result[field] = left + (right - left) * ratio
            elif left is not None or right is not None:
                result[field] = left if left is not None else right
        return result

    start_point = boundary_point(start_dt)
    finish_point = boundary_point(finish_dt)
    if start_point is None or finish_point is None:
        return []
    # Discard the bracketing samples after using them. The returned stream now
    # starts at exactly t=0 and ends at the official lap duration.
    car = [start_point] + [
        item for item in car
        if start_dt < datetime.fromisoformat(item["date"].replace('Z', '+00:00')) < finish_dt
    ] + [finish_point]

    samples: list[dict[str, Any]] = []
    distance = 0.0
    previous = None
    previous_speed = None
    for point in car:
        timestamp = datetime.fromisoformat(point["date"].replace('Z', '+00:00'))
        elapsed = (timestamp - start_dt).total_seconds()
        current_speed = float(point.get("speed") or 0)
        if previous is not None:
            dt = (timestamp - previous).total_seconds()
            # Trapezoidal integration is a better estimate for OpenF1's
            # sample-and-hold speed channel than applying the new value across
            # the whole interval. It reduces lap-length drift before the
            # browser projects traces onto the reference circuit path.
            interval_speed = (float(previous_speed or 0) + current_speed) / 2
            distance += max(0.0, interval_speed / 3.6 * max(0.0, dt))
        previous = timestamp
        previous_speed = current_speed
        samples.append({
            "Distance": distance,
            "ElapsedSeconds": elapsed,
            "Timestamp": timestamp.timestamp(),
            "Speed": current_speed,
            "Throttle": point.get("throttle"),
            "Brake": point.get("brake"),
            "RPM": point.get("rpm"),
            "nGear": point.get("n_gear"),
            "DRS": point.get("drs"),
            "X": point.get("x"),
            "Y": point.get("y"),
            "IsInterpolatedBoundary":bool(point.get('boundary_interpolated')),
            "SourceIntervalSeconds":point.get('source_interval_s',0),
            "PositionIntervalSeconds":point.get('position_interval_s'),
            "ChannelSources":{c:'OpenF1:boundary-derived' if point.get('boundary_interpolated') else 'OpenF1:native' for c in ('Speed','Throttle','Brake','RPM','nGear','DRS')},
        })
    return samples


def openf1_lap_telemetry(
    year: int,
    gp: str,
    session_name: str,
    driver_number: str,
    lap_number: int,
) -> list[dict[str, Any]]:
    # OpenF1 publishes the car and location channels independently. A newly
    # completed lap can have speed available a few seconds before coordinates.
    # Refresh current-season source data every 30 seconds until the prepared
    # cache records a complete response; historical source data is immutable.
    freshness_bucket = int(time.time() // 30) if year >= datetime.now().year else 0
    return _openf1_lap_telemetry(
        year, gp, session_name, driver_number, lap_number, freshness_bucket
    )


@lru_cache(maxsize=16)
def load_session(year: int, gp: str, session_name: str, round_number: int | None = None):
    # Do not pass the calendar round straight to the F1 Timing schedule. That
    # schedule may only contain weekends with timing data available, so its
    # round numbers are not always the championship round numbers. In the
    # worst case it silently selected another event; in the best case it raised
    # "Invalid round". Resolve the exact event name from the full calendar,
    # then create the session from that event.
    backend = "fastf1" if year >= 2018 else "ergast"

    def load():
        event = exact_fastf1_event(year, gp, backend=backend)
        session = event.get_session(session_name)
        # Session controls need timing/lap data, not the multi-megabyte car stream
        # for every driver. Fetch the car stream only if OpenF1 cannot provide a
        # selected lap (mainly older seasons).
        session.load(laps=True, telemetry=False, weather=True, messages=False)
        return session
    return archive_guard(year, gp, session_name, load)


@lru_cache(maxsize=8)
def load_telemetry_session(year: int, gp: str, session_name: str):
    """Load FastF1 car data only as the historical fallback."""
    backend = "fastf1" if year >= 2018 else "ergast"
    event = exact_fastf1_event(year, gp, backend=backend)
    data = event.get_session(session_name)
    data.load(laps=True, telemetry=True, weather=False, messages=False)
    return data


def _calendar_session_name(value: Any) -> str:
    name = str(value or "").strip()
    if name == "Sprint Shootout":
        return "Sprint Qualifying"
    return name


def _parse_openf1_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed
    except (TypeError, ValueError):
        return None


def enrich_recent_openf1_statuses(year: int, events: list[dict[str, Any]]) -> None:
    """Add authoritative status for the active/recent race weekend.

    Scheduled end times are not proof that a session finished: a red-flagged or
    aborted session may resume. For sessions from the last week, completion is
    recorded only when OpenF1 race control contains CHEQUERED/SESSION FINISHED.
    Older sessions keep the normal historical calendar fallback.
    """
    now = datetime.now(timezone.utc)
    if year != now.year or not events:
        return
    try:
        sessions = openf1("sessions", year=year)
    except Exception as error:
        logger.debug("OpenF1 calendar status unavailable: %s", error)
        return

    event_dates = []
    for event in events:
        try:
            event_dates.append((datetime.fromisoformat(event["date"]).date(), event))
        except (KeyError, TypeError, ValueError):
            continue

    recent: list[tuple[dict[str, Any], str, dict[str, Any], datetime | None]] = []
    for source in sessions:
        start = _parse_openf1_datetime(source.get("date_start"))
        if start is None or not event_dates:
            continue
        nearest_date, event = min(event_dates, key=lambda row: abs((row[0] - start.date()).days))
        if abs((nearest_date - start.date()).days) > 3:
            continue
        session_name = _calendar_session_name(source.get("session_name"))
        if session_name not in event.get("sessions", []):
            continue
        event.setdefault("session_dates", {})[session_name] = start.isoformat()
        # Event names are not circuit identities (Bahrain 2026 runs at Sepang).
        event["location"] = source.get("location") or source.get("circuit_short_name")
        event["circuit_key"] = integer(source.get("circuit_key"), 0) or None
        end = _parse_openf1_datetime(source.get("date_end"))
        if end is not None:
            event.setdefault("session_end_dates", {})[session_name] = end.isoformat()

        statuses = event.setdefault("session_statuses", {})
        if source.get("is_cancelled") is True:
            statuses[session_name] = "cancelled"
        elif start > now:
            statuses[session_name] = "upcoming"
        elif start >= now - timedelta(days=7):
            recent.append((event, session_name, source, end))

    def race_control_status(item):
        event, session_name, source, end = item
        try:
            messages = openf1("race_control", session_key=source["session_key"])
        except Exception:
            messages = []
        finished = any(
            str(message.get("flag") or "").upper() == "CHEQUERED"
            or str(message.get("message") or "").upper() in {
                "CHEQUERED FLAG", "SESSION FINISHED"
            }
            for message in messages
        )
        if not finished and end is not None and end < now:
            # Race-control messages can be missing even after the official
            # classification is published. OpenF1 only exposes these final
            # standings after the session, so they are stronger evidence than
            # the schedule's expected end timestamp alone.
            try:
                results = openf1("session_result", session_key=source["session_key"])
                finished = len(results) >= 3 and any(
                    row.get("position") is not None for row in results
                )
            except Exception:
                pass
        if not finished and end is not None and end < now:
            # OpenF1 may omit/rate-limit its finish messages even while the
            # official timing archive is already finalised. Read the tiny
            # session-info feed, not the full driver/lap/telemetry data.
            try:
                from urllib.parse import quote
                slug = str(event["name"]).replace(" ", "_")
                session_slug = session_name.replace(" ", "_")
                path = f"{year}/{event['date']}_{slug}/{source['date_start'][:10]}_{session_slug}/SessionInfo.json"
                request = URLRequest("https://livetiming.formula1.com/static/" + quote(path, safe="/"))
                with urlopen(request, timeout=5) as result:
                    info = json.loads(result.read().decode("utf-8-sig"))
                # Require the exact session key; never trust a same-named GP
                # or a schedule end time as evidence of completion.
                finished = integer(info.get("Key"), 0) == integer(source.get("session_key"), -1) and str(info.get("SessionStatus", "")).lower() in {"finalised", "finalized", "finished"}
            except Exception:
                pass
        if finished:
            status = "completed"
        elif end is not None and end < now:
            status = "unknown"
        else:
            status = "live"
        return event, session_name, status

    if recent:
        with ThreadPoolExecutor(max_workers=min(5, len(recent)), thread_name_prefix="session-status") as pool:
            for event, session_name, status in pool.map(race_control_status, recent):
                event.setdefault("session_statuses", {})[session_name] = status


def event_calendar(year: int) -> list[dict[str, Any]]:
    try:
        schedule = fastf1_runtime().get_event_schedule(year, include_testing=False)
    except Exception as exc:
        raise ValueError(f"Could not load the {year} calendar: {exc}") from exc
    result = []
    for _, event in schedule.iterrows():
        sessions = []
        session_dates = {}
        for index in range(1, 6):
            name = event.get(f"Session{index}")
            if name and str(name) not in {"nan", "None"}:
                session_name = str(name)
                sessions.append(session_name)
                # FastF1 schedules expose UTC dates on newer versions and
                # local session dates on older versions. Either lets the UI
                # choose the latest session that has actually finished.
                date_value = event.get(f"Session{index}DateUtc")
                if date_value is None or str(date_value) in {"NaT", "nan", "None"}:
                    date_value = event.get(f"Session{index}Date")
                if date_value is not None and str(date_value) not in {"NaT", "nan", "None"}:
                    date_text = str(date_value)
                    # FastF1's older schedule backend supplies UTC timestamps
                    # without an explicit suffix. Make the timezone unambiguous
                    # for the browser's completed-session calculation.
                    if "+" not in date_text and not date_text.endswith("Z"):
                        date_text += "Z"
                    session_dates[session_name] = date_text
        country_value = event.get("Country")
        country = "" if country_value is None or str(country_value) in {"nan", "None"} else str(country_value)
        result.append({
            "round": int(event["RoundNumber"]),
            "name": str(event["EventName"]),
            "country": country,
            "location": str(event.get("Location") or ""),
            "date": str(event["EventDate"])[:10],
            "sessions": sessions,
            "session_dates": session_dates,
        })
    enrich_recent_openf1_statuses(year, result)
    return result


def get_tire_nominations(year: int, gp: str) -> list[str]:
    # Standard Pirelli dry slick compound allocations for common Grand Prix
    name = gp.lower()

    # 2026 allocations published by Pirelli. Venue-name heuristics below
    # assign the wrong range to these races.
    # https://press.pirelli.com/the-tyre-compound-selections-for-monte-carlo-and-barcelona/
    # https://press.pirelli.com/tyre-compounds-selected-for-zandvoort-monza-and-madrid/
    # https://press.pirelli.com/tyre-compound-selections-for-baku-sepang-and-singapore/
    if year == 2026:
        if any(k in name for k in [
            "netherlands", "dutch", "zandvoort", "spain", "spanish",
            "madrid", "barcelona", "catalunya", "bahrain", "sepang",
        ]):
            return ["C2", "C3", "C4"]
    
    # 2025 special street races with C6
    if year == 2025:
        if "monaco" in name or "monal" in name:
            return ["C4", "C5", "C6"]
        if "canada" in name or "montreal" in name:
            return ["C4", "C5", "C6"]
        if "azerbaijan" in name or "baku" in name:
            return ["C4", "C5", "C6"]
            
    # Hardest selection: C1, C2, C3
    if any(k in name for k in ["bahrain", "suzuka", "japan", "spain", "barcelona", "great britain", "british", "silverstone", "zandvoort", "netherlands", "qatar", "lusail"]):
        return ["C1", "C2", "C3"]
        
    # Medium selection: C2, C3, C4
    if any(k in name for k in ["china", "shanghai", "miami", "belgium", "spa", "americas", "austin", "united states"]):
        return ["C2", "C3", "C4"]
        
    # Softest selection: C3, C4, C5
    # Default to C3, C4, C5 for street circuits and high grip tracks (Melbourne, Monaco, Montreal, Austria, Hungary, Monza, Baku, Singapore, Mexico, Brazil, Las Vegas, Abu Dhabi)
    return ["C3", "C4", "C5"]


def get_fastest_lap_time(driver_obj: dict[str, Any]) -> float:
    valid_times = [
        lap["time"] for lap in driver_obj.get("laps", [])
        if lap.get("time") is not None and lap["time"] > 0
        and not lap.get("in_lap") and not lap.get("out_lap")
    ]
    return min(valid_times) if valid_times else float("inf")


def sort_session_drivers(drivers: list[dict[str, Any]]) -> None:
    """Prefer the provider's official classification over inferred pace."""
    def classification_key(driver: dict[str, Any]) -> tuple[int, float, float]:
        position = integer(driver.get("position"), 0)
        if position > 0:
            return (0, float(position), get_fastest_lap_time(driver))
        return (1, get_fastest_lap_time(driver), float("inf"))

    drivers.sort(key=classification_key)


@lru_cache(maxsize=32)
def get_fallback_circuit_corners(
    year: int, gp: str, session_name: str, current_location: str = ""
) -> list[dict[str, Any]]:
    # Only reuse circuit metadata from the same venue. Event names survive
    # venue changes (notably Spanish GP: Barcelona -> Madrid), so matching the
    # name alone can silently attach a different track's corner positions.
    normalized_location = current_location.strip().casefold()
    first_fallback_year = min(year - 1, 2025)
    # Corner positions are venue metadata, the same for every session: keep
    # them on disk, keyed by venue and the years searched, so a cold session
    # never reloads past seasons. A miss is remembered for a day; the archive
    # may come back.
    venue_key = (gp, normalized_location, first_fallback_year)
    remembered = read_prepared_cache("venue-corners", 0, *venue_key)
    if remembered is not None and (remembered.get("corners")
                                   or time.time()-float(remembered.get("at", 0)) < ARCHIVE_RETRY_S):
        return remembered.get("corners") or []
    corners = _load_fallback_circuit_corners(gp, session_name, current_location, normalized_location, first_fallback_year)
    searched = range(first_fallback_year, max(2017, first_fallback_year - 3), -1)
    if not corners and any(archive_breaker_open(y) for y in searched):
        return []  # Not every season was tried; do not remember a miss.
    write_prepared_cache("venue-corners", 0, {"corners": corners, "at": time.time()}, *venue_key)
    return corners


def _load_fallback_circuit_corners(gp, session_name, current_location, normalized_location, first_fallback_year):
    for fallback_year in range(first_fallback_year, max(2017, first_fallback_year - 3), -1):
        try:
            fb_event = exact_fastf1_event(
                fallback_year, gp, location=current_location
            )
            if fb_event is not None:
                fallback_location = str(fb_event.get("Location") or "").strip().casefold()
                # Providers name one venue differently (OpenF1 "Miami Gardens",
                # FastF1 "Miami"); a different track shares no name at all.
                if (normalized_location and fallback_location
                        and normalized_location not in fallback_location
                        and fallback_location not in normalized_location):
                    continue
                # Corner positions are the same in every session; a past
                # season may not have had this one (a sprint), so use qualifying.
                fb_sess = fb_event.get_session("Qualifying")
                def load_metadata(fb_sess=fb_sess):
                    fb_sess.load(laps=True, telemetry=False, weather=False, messages=False)
                    return fb_sess
                archive_guard(fallback_year, gp, "Qualifying", load_metadata)
                c_info = fb_sess.get_circuit_info()
                if c_info is not None and c_info.corners is not None and not c_info.corners.empty:
                    corners = []
                    for _, row in c_info.corners.iterrows():
                        x, y = seconds(row.get("X")), seconds(row.get("Y"))
                        dist = seconds(row.get("Distance"))
                        corners.append({
                            "number": str(row["Number"]),
                            "letter": str(row.get("Letter") or ""),
                            "x": x,
                            "y": y,
                            "angle": seconds(row.get("Angle")),
                            "distance": float(dist) if dist is not None else None,
                            "fraction": None,
                        })
                    if corners:
                        return corners
        except Exception as fb_err:
            logger.debug("Fallback corner load for %s failed: %s", fallback_year, fb_err)
    return []


def project_corners_onto_lap(data: Any, samples: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Attach official corner labels to a specific telemetry lap.

    FastF1 does not populate CircuitInfo.Distance unless its car archive is
    available. OpenF1 still supplies the same X/Y coordinate space, so resolve
    each corner once on the server against the exact reference lap instead of
    asking the browser to reconcile two partial data sources during drawing.
    """
    if len(samples) < 2:
        return []
    total_distance = seconds(samples[-1].get("Distance"))
    points = [point for point in samples
              if seconds(point.get("Distance")) is not None
              and seconds(point.get("X")) is not None
              and seconds(point.get("Y")) is not None]
    if not total_distance or not points:
        return []
    try:
        circuit_info = data.get_circuit_info()
        marker_rows = circuit_info.corners if circuit_info is not None else None
    except Exception:
        marker_rows = None
    if marker_rows is None or marker_rows.empty:
        return []

    result: list[dict[str, Any]] = []
    previous_distance = 0.0
    ordered_rows = sorted(marker_rows.iterrows(), key=lambda item: (
        int(item[1]["Number"]), str(item[1].get("Letter") or "")
    ))
    for _, row in ordered_rows:
        x, y = seconds(row.get("X")), seconds(row.get("Y"))
        if x is None or y is None:
            continue
        # Street circuits can revisit the same area later in the lap. Baku's
        # T20 is near T5/T6; unconstrained nearest-neighbour puts it at 2 km.
        candidates = [point for point in points
                      if seconds(point["Distance"]) > previous_distance + total_distance * .001]
        if not candidates:
            continue
        nearest = min(candidates, key=lambda point: (seconds(point["X"]) - x) ** 2 + (seconds(point["Y"]) - y) ** 2)
        fraction = seconds(nearest.get("Distance")) / total_distance
        if not 0 < fraction <= 1:
            continue
        previous_distance = seconds(nearest.get("Distance"))
        result.append({
            "number": str(row["Number"]),
            "letter": str(row.get("Letter") or ""),
            "x": x,
            "y": y,
            "angle": seconds(row.get("Angle")),
            "distance": None,
            "fraction": fraction,
            "source": "lap_projection",
        })
    return result


@app.get("/api/events")
def events(response: Response, year: int = Query(2025, ge=2014)):
    current = year >= datetime.now(timezone.utc).year
    response.headers["Cache-Control"] = "no-store" if current else "public, max-age=86400"
    cached = None if current else read_prepared_cache("events", year)
    if cached is not None:
        return cached
    try:
        result = event_calendar(year)
    except Exception as exc:
        raise HTTPException(422, str(exc)) from exc
    if not current:
        write_prepared_cache("events", year, result)
    return result


def openf1_lap_gaps(rows: list[dict[str, Any]]) -> dict[int, list[int]]:
    """Return missing internal lap numbers for each driver."""
    lap_numbers: dict[int, set[int]] = {}
    for row in rows:
        driver = integer(row.get("driver_number"), -1)
        lap = integer(row.get("lap_number"), -1)
        if driver >= 0 and lap > 0:
            lap_numbers.setdefault(driver, set()).add(lap)
    gaps = {}
    for driver, numbers in lap_numbers.items():
        if len(numbers) < 2:
            continue
        missing = sorted(set(range(min(numbers), max(numbers) + 1)) - numbers)
        if missing:
            gaps[driver] = missing
    return gaps


@lru_cache(maxsize=64)
def fetch_openf1_session_drivers(
    year: int,
    gp: str,
    session_name: str,
    freshness_bucket: int = 0,
) -> list[dict[str, Any]]:
    try:
        matching_session = openf1_session(year, gp, session_name)
        if not matching_session:
            return []
        session_key = matching_session["session_key"]

        with ThreadPoolExecutor(max_workers=4, thread_name_prefix="openf1-session") as pool:
            drivers_future = pool.submit(openf1, "drivers", session_key=session_key)
            laps_future = pool.submit(openf1, "laps", session_key=session_key)
            stints_future = pool.submit(openf1, "stints", session_key=session_key)
            results_future = pool.submit(openf1, "session_result", session_key=session_key)
            drivers_raw = drivers_future.result()
            laps_raw = laps_future.result()
            try:
                stints_raw = stints_future.result()
            except Exception as stints_err:
                logger.warning("OpenF1 stints fetch failed: %s", stints_err)
                stints_raw = []
            try:
                results_raw = results_future.result()
            except Exception as results_err:
                logger.warning("OpenF1 session-result fetch failed: %s", results_err)
                results_raw = []
        gaps = openf1_lap_gaps(laps_raw)
        if gaps:
            # OpenF1 may re-ingest a session after repairing missing lap rows.
            # Retry once before exposing an incomplete sequence, then mark the
            # response non-cacheable if the source still has internal gaps.
            try:
                refreshed = openf1("laps", session_key=session_key)
                if len(refreshed) >= len(laps_raw):
                    laps_raw = refreshed
                    gaps = openf1_lap_gaps(laps_raw)
            except Exception as retry_error:
                logger.debug("OpenF1 lap integrity retry failed: %s", retry_error)
            if gaps:
                logger.warning("OpenF1 session %s has internal lap gaps: %s", session_key, gaps)
        # Weather is optional context. Fetch it only after the required timing
        # calls finish so a free-tier rate limit cannot starve drivers or laps.
        try:
            weather_raw = openf1("weather", session_key=session_key)
        except Exception as weather_err:
            logger.warning("OpenF1 weather fetch failed: %s", weather_err)
            weather_raw = []

        lap_stint_map: dict[tuple[int, int], tuple[int, str, float | None]] = {}
        for stint in stints_raw:
            d_num = stint.get("driver_number")
            st_num = stint.get("stint_number", 1)
            comp = str(stint.get("compound") or "UNKNOWN").upper()
            l_start = stint.get("lap_start")
            l_end = stint.get("lap_end")
            age_at_start = seconds(stint.get("tyre_age_at_start"))
            if d_num is not None and l_start is not None and l_end is not None:
                for l_num in range(int(l_start), int(l_end) + 1):
                    tyre_life = age_at_start + (l_num - int(l_start)) + 1 if age_at_start is not None else None
                    lap_stint_map[(int(d_num), l_num)] = (int(st_num), comp, tyre_life)

        def openf1_conditions(date_value: Any, duration: float | None) -> dict[str, Any] | None:
            if not date_value or not weather_raw:
                return None
            try:
                target = datetime.fromisoformat(str(date_value).replace("Z", "+00:00"))
                if duration is not None:
                    target += timedelta(seconds=duration / 2)
                nearest = min(
                    weather_raw,
                    key=lambda item: abs((datetime.fromisoformat(str(item["date"]).replace("Z", "+00:00")) - target).total_seconds()),
                )
                result = {
                    "air_temperature": seconds(nearest.get("air_temperature")),
                    "track_temperature": seconds(nearest.get("track_temperature")),
                    "wind_speed": seconds(nearest.get("wind_speed")),
                    "wind_direction": seconds(nearest.get("wind_direction")),
                    "rainfall": None if nearest.get("rainfall") is None else bool(nearest.get("rainfall")),
                }
                return result if any(value is not None for value in result.values()) else None
            except (KeyError, TypeError, ValueError):
                return None

        driver_laps: dict[int, list[dict[str, Any]]] = {}
        for lap in laps_raw:
            d_num = lap.get("driver_number")
            if d_num is None:
                continue
            if d_num not in driver_laps:
                driver_laps[d_num] = []
            
            lap_num = lap.get("lap_number")
            lap_dur = lap.get("lap_duration")
            if lap_num is not None:
                st_num, comp, tyre_life = lap_stint_map.get(
                    (int(d_num), int(lap_num)), (1, "UNKNOWN", None)
                )
                driver_laps[d_num].append({
                    "lap": int(lap_num),
                    "time": float(lap_dur) if lap_dur is not None else None,
                    "display_time": float(lap_dur) if lap_dur is not None else None,
                    "display_time_estimated": lap.get("is_pit_out_lap") is True,
                    "s1": float(lap["duration_sector_1"]) if lap.get("duration_sector_1") is not None else None,
                    "s2": float(lap["duration_sector_2"]) if lap.get("duration_sector_2") is not None else None,
                    "s3": float(lap["duration_sector_3"]) if lap.get("duration_sector_3") is not None else None,
                    "compound": comp,
                    "tyre_life": tyre_life,
                    "stint": st_num,
                    "phase": None,
                    "in_lap": False,
                    "out_lap": lap.get("is_pit_out_lap") is True,
                    "_date_start": lap.get("date_start"),
                })

        # OpenF1 marks pit-out laps but may omit their lap_duration. Its
        # date_start is explicitly approximate, so expose the interval to the
        # next lap as an estimated pit-to-line duration instead of pretending
        # it is an official lap time.
        for laps in driver_laps.values():
            laps.sort(key=lambda item: item["lap"])
            for index, lap_info in enumerate(laps):
                if lap_info.get("out_lap") and lap_info.get("display_time") is None and index + 1 < len(laps):
                    current_start = lap_info.get("_date_start")
                    next_start = laps[index + 1].get("_date_start")
                    if current_start and next_start:
                        try:
                            current_dt = datetime.fromisoformat(str(current_start).replace("Z", "+00:00"))
                            next_dt = datetime.fromisoformat(str(next_start).replace("Z", "+00:00"))
                            estimate = (next_dt - current_dt).total_seconds()
                            if 0 < estimate < 300:
                                lap_info["display_time"] = estimate
                                lap_info["display_time_estimated"] = True
                        except (TypeError, ValueError):
                            pass
                lap_info["conditions"] = openf1_conditions(
                    lap_info.get("_date_start"), seconds(lap_info.get("time"))
                )
                lap_info["date_start"] = lap_info.pop("_date_start", None)
                
        result_positions = {
            integer(item.get("driver_number"), -1): integer(item.get("position"), 0)
            for item in results_raw
            if integer(item.get("driver_number"), -1) >= 0
            and integer(item.get("position"), 0) > 0
        }

        result = []
        for d in drivers_raw:
            d_num = d.get("driver_number")
            driver_id = integer(d_num, -1)
            acronym = d.get("name_acronym") or str(d_num)
            full_name = d.get("full_name") or d.get("broadcast_name") or acronym
            team_name = d.get("team_name") or ""
            team_color = "#" + str(d.get("team_colour") or "777777").lstrip("#")
            
            laps = driver_laps.get(d_num, [])
            classification = next((item for item in results_raw if integer(item.get("driver_number"), -1) == driver_id), {})
            if laps or classification:
                result.append({
                    "code": acronym,
                    "number": str(d_num),
                    "name": full_name,
                    "team": team_name,
                    "team_color": team_color,
                    "position": result_positions.get(integer(d_num, -1)),
                    "result": {
                        "points": seconds(classification.get("points")),
                        "status": "DSQ" if classification.get("dsq") else "DNS" if classification.get("dns") else "DNF" if classification.get("dnf") else "Finished" if classification else None,
                        "gap": classification.get("gap_to_leader") if matching_session.get("session_name") in ("Race", "Sprint") else None,
                    },
                    "lap_data_complete": driver_id not in gaps,
                    "missing_laps": gaps.get(driver_id, []),
                    "laps": laps,
                })
        sort_session_drivers(result)
        return result
    except Exception as exc:
        logger.warning("OpenF1 session fallback failed: %s", exc)
        return []


@app.get("/api/session")
def session_data(
    response: Response,
    year: int = Query(2025, ge=2014),
    gp: str = Query("British Grand Prix"),
    round: int | None = Query(None, ge=1),
    session: str = Query("Q"),
    fresh: bool = Query(False),
):
    started = time.perf_counter()
    if fresh:
        response.headers['Cache-Control'] = 'no-store'
    if year < 2018:
        raise HTTPException(
            422,
            "Race calendars are available from 2014, but public F1 car telemetry begins in 2018.",
        )
    cached = None if fresh else read_prepared_cache("session", year, SESSION_CACHE_SCHEMA, gp, round, session)
    if cached is not None:
        # Prepared sessions can outlive a newly verified tyre allocation.
        # Correct the API payload itself, not just the dashboard label.
        nominated = get_tire_nominations(year, gp)
        if cached.get("compounds") != nominated:
            cached = {**cached, "compounds": nominated}
        return cached
    from verified_sources import recorded_session, recorded_payload
    recording = recorded_session(year, gp, session)
    if recording and not fresh:
        payload = recorded_payload(recording)
        payload['compounds'] = get_tire_nominations(year, gp)
        return payload
    try:
        data = load_fresh_session(year, gp, session) if fresh else load_session(year, gp, session, round)
        if data.laps.empty:
            raise ValueError('Timing archive returned no laps')
    except Exception as exc:
        if recording:
            payload = recorded_payload(recording)
            payload['source_cache']['refresh_failed'] = fresh
            payload['compounds'] = get_tire_nominations(year, gp)
            return payload
        if session in ('Q', 'R', 'SQ', 'S', 'Qualifying', 'Race', 'Sprint Qualifying', 'Sprint Shootout', 'Sprint') and year >= 2023:
            try:
                from openf1_performance import session_payload
                code = {'Qualifying': 'Q', 'Race': 'R', 'Sprint Qualifying': 'SQ',
                        'Sprint Shootout': 'SQ', 'Sprint': 'S'}.get(session, session)
                alternate = load_openf1_performance(year, gp, code, fresh=fresh)
                payload = session_payload(year, gp, code, alternate.apex_source_bundle)
                payload['source_cache'] = alternate.apex_source_notice
                payload['compounds'] = get_tire_nominations(year, gp)
                # The alternate source has no circuit info. Official turn
                # positions are venue metadata, so reuse the same-venue
                # fallback (never a different track), or the comparison has
                # no corner controls although the telemetry is complete.
                if not payload.get('corners') and not fresh:
                    payload['corners'] = get_fallback_circuit_corners(year, gp, session, str(payload.get('location') or ''))
                return payload
            except Exception as fallback_error:
                logger.warning('Alternate session timing unavailable for %s: %s', gp, fallback_error)
        raise HTTPException(422, f"Could not load this session: {exc}") from exc

    qualifying_phase: dict[Any, str] = {}
    all_laps = None
    weather_data = None
    try:
        all_laps = data.laps
        weather_data = prepare_weather_lookup(data.weather_data)
    except Exception as exc:
        logger.warning("Session laps not loaded: %s", exc)

    if all_laps is not None and not all_laps.empty and data.name in getattr(data, "_QUALI_LIKE_SESSIONS", ()):
        try:
            for index, phase_laps in enumerate(all_laps.split_qualifying_sessions(), start=1):
                if phase_laps is not None:
                    for lap_index in phase_laps.index:
                        qualifying_phase[lap_index] = f"Q{index}"
        except Exception as exc:
            logger.warning("Could not split qualifying laps into Q1/Q2/Q3: %s", exc)

    drivers = []
    for code in data.drivers:
        try:
            info = data.get_driver(code)
            laps_list = []
            if all_laps is not None and not all_laps.empty:
                driver_laps = all_laps.pick_drivers(code)
                if not driver_laps.empty:
                    for lap_index, row in driver_laps.iterrows():
                        if row.get("LapNumber") is not None:
                            laps_list.append({
                                "lap": int(row["LapNumber"]),
                                "date_start": utc_timestamp(row.get("LapStartDate")),
                                # A pit-out trace starts at pit exit, not at
                                # the preceding timing line in the pit lane.
                                "lap_start_seconds": (
                                    seconds(row.get("PitOutTime"))
                                    if seconds(row.get("PitOutTime")) is not None
                                    else seconds(row.get("LapStartTime"))
                                ),
                                "lap_end_seconds": seconds(row.get("Time")),
                                "time": seconds(row["LapTime"]),
                                "track_status": str(row.get("TrackStatus") or ""),
                                "deleted": bool(row.get("Deleted")) if pd.notna(row.get("Deleted")) else False,
                                "accurate": bool(row.get("IsAccurate")) if pd.notna(row.get("IsAccurate")) else None,
                                "display_time": seconds(row["LapTime"]),
                                "display_time_estimated": False,
                                "s1": seconds(row["Sector1Time"]),
                                "s2": seconds(row["Sector2Time"]),
                                "s3": seconds(row["Sector3Time"]),
                                "compound": str(row.get("Compound", "UNKNOWN")),
                                "tyre_life": seconds(row.get("TyreLife")),
                                "stint": integer(row.get("Stint")),
                                "phase": qualifying_phase.get(lap_index),
                                "in_lap": seconds(row.get("PitInTime")) is not None,
                                "out_lap": seconds(row.get("PitOutTime")) is not None,
                                "_pit_out_time": seconds(row.get("PitOutTime")),
                                "_lap_end_time": seconds(row.get("Time")),
                                "_weather_time": (
                                    seconds(row.get("Time")) - seconds(row.get("LapTime")) / 2
                                    if seconds(row.get("Time")) is not None and seconds(row.get("LapTime")) is not None
                                    else seconds(row.get("Time"))
                                ),
                            })
                    for lap_info in laps_list:
                        lap_info["conditions"] = nearest_weather_conditions(
                            weather_data, lap_info.get("_weather_time")
                        )
                        if lap_info.get("out_lap"):
                            pit_out = lap_info.get("_pit_out_time")
                            lap_end = lap_info.get("_lap_end_time")
                            if pit_out is not None and lap_end is not None:
                                estimate = lap_end - pit_out
                                if 0 < estimate < 300:
                                    lap_info["display_time"] = estimate
                                    lap_info["display_time_estimated"] = True
                        lap_info.pop("_pit_out_time", None)
                        lap_info.pop("_lap_end_time", None)
                        lap_info.pop("_weather_time", None)
            drivers.append({
                "code": str(info.get("Abbreviation", code)),
                "number": str(info.get("DriverNumber", "")),
                "name": str(info.get("FullName", info.get("BroadcastName", code))),
                "team": str(info.get("TeamName", "")),
                "team_color": "#" + str(info.get("TeamColor", "777777")).lstrip("#"),
                "position": integer(info.get("Position"), 0) or None,
                "result": {
                    "points": seconds(info.get("Points")),
                    "status": str(info.get("Status") or "") if pd.notna(info.get("Status")) else None,
                    "gap": (0 if integer(info.get("Position"), 0) == 1 else seconds(info.get("Time"))) if data.name in ("Race", "Sprint") else None,
                },
                "laps": laps_list,
            })
        except Exception as driver_err:
            logger.warning("Could not parse driver %s: %s", code, driver_err)

    # FastF1 can have the classification and stint structure while individual
    # same-day timing laps are still missing. Fill only those gaps from the
    # official timing feed; never replace a pit-out partial-lap estimate.
    if data.name in ("Race", "Sprint") and year >= datetime.now().year:
        missing = any(
            lap.get("time") is None and not lap.get("out_lap")
            for driver in drivers for lap in driver["laps"]
        )
        if missing:
            try:
                sessions = openf1("sessions", year=year, session_name=data.name)
                event_name = _normalised_name(str(data.event.get("EventName", gp)))
                event_country = _normalised_name(str(data.event.get("Country", "")))
                matching = next((item for item in reversed(sessions)
                    if (_normalised_name(str(item.get("country_name", ""))) == event_country and event_country)
                    or (_normalised_name(str(item.get("country_name", ""))) in event_name
                        and _normalised_name(str(item.get("country_name", ""))))), None)
                if matching:
                    timing = openf1("laps", session_key=matching["session_key"])
                    by_number_lap = {
                        (integer(item.get("driver_number")), integer(item.get("lap_number"))): seconds(item.get("lap_duration"))
                        for item in timing
                    }
                    for driver in drivers:
                        number = integer(driver.get("number"))
                        for lap in driver["laps"]:
                            duration = by_number_lap.get((number, lap["lap"]))
                            if lap.get("time") is None and not lap.get("out_lap") and duration is not None:
                                lap["time"] = duration
                                lap["display_time"] = duration
                                lap["timing_source"] = "OpenF1"
            except Exception as exc:
                logger.warning("Could not fill missing race lap times from OpenF1: %s", exc)

    # Fallback to OpenF1 real-time timing API if FastF1 has no laps (e.g. same-day sessions)
    has_any_laps = any(d["laps"] for d in drivers)
    lap_data_complete = True
    if not has_any_laps:
        logger.info("FastF1 has no laps for %s %s. Attempting OpenF1 real-time fallback...", gp, session)
        bucket_seconds = 600 if year >= datetime.now().year else 86400
        bucket = int(time.time() // bucket_seconds)
        retrieve = fetch_openf1_session_drivers.__wrapped__ if fresh else fetch_openf1_session_drivers
        of1_drivers = retrieve(year, gp, session, bucket)
        if of1_drivers:
            original_results = {driver["number"]: driver.get("result", {}) for driver in drivers}
            for driver in of1_drivers:
                original = original_results.get(driver["number"], {})
                if driver["result"].get("points") is None:
                    driver["result"]["points"] = original.get("points")
            drivers = of1_drivers
            lap_data_complete = all(
                driver.get("lap_data_complete", True) for driver in drivers
            )
            if not lap_data_complete:
                response.headers["Cache-Control"] = "no-store, max-age=0"

    sort_session_drivers(drivers)

    corners = []
    circuit_rotation = 0.0
    try:
        circuit_info = data.get_circuit_info()
        rotation_value = seconds(getattr(circuit_info, "rotation", 0.0)) if circuit_info is not None else None
        if rotation_value is not None:
            circuit_rotation = rotation_value
        if circuit_info is not None and circuit_info.corners is not None and not circuit_info.corners.empty:
            for _, row in circuit_info.corners.iterrows():
                x, y = seconds(row.get("X")), seconds(row.get("Y"))
                dist = seconds(row.get("Distance"))
                corners.append({
                    "number": str(row["Number"]),
                    "letter": str(row.get("Letter") or ""),
                    "x": x,
                    "y": y,
                    "angle": seconds(row.get("Angle")),
                    "distance": float(dist) if dist is not None else None,
                    "fraction": None,
                })
    except Exception as exc:
        logger.warning("Could not load circuit corners: %s", exc)

    if not corners and not fresh:
        current_location = str(data.event.get("Location") or "")
        corners = get_fallback_circuit_corners(year, gp, session, current_location)

    session_date_iso = None
    try:
        if getattr(data, "date", None) is not None:
            session_date_iso = str(data.date)
    except Exception:
        pass

    try:
        session_info = data.session_info or {}
    except Exception:
        session_info = {}
    payload = {
        "event": data.event["EventName"],
        "session": data.name,
        "date": session_date_iso,
        "drivers": drivers,
        "corners": corners,
        "circuit_rotation": circuit_rotation,
        "location": str(session_info.get("Meeting", {}).get("Location") or data.event.get("Location") or ""),
        "circuit_key": integer(session_info.get("Meeting", {}).get("Circuit", {}).get("Key"), 0) or None,
        "compounds": get_tire_nominations(year, gp),
        "openf1_session_key": integer(session_info.get("Key"), 0) or None,
        "lap_data_complete": lap_data_complete,
    }
    response.headers['Server-Timing'] = f'session;dur={(time.perf_counter()-started)*1000:.1f}'
    response.headers['Timing-Allow-Origin'] = '*'
    if drivers and lap_data_complete and not fresh:
        write_prepared_cache("session", year, payload, SESSION_CACHE_SCHEMA, gp, round, session)
    return payload


@app.get('/api/performance/race-laps')
def race_native_laps(response: Response, year: int = Query(..., ge=2023, le=2100),
                     gp: str = Query(..., min_length=3, max_length=120),
                     driver_number: str = Query(..., pattern=r'^\d{1,3}$'),
                     session_key: int = Query(..., ge=1), fresh: bool = False):
    """Three upstream requests per driver, not three per lap/cohort."""
    from verified_sources import recorded_session
    recording = recorded_session(year, gp, 'R')
    recorded_key = (recording or {}).get('data', {}).get('openf1_session_key')
    if recorded_key != session_key:
        actual = openf1_session(year, gp, 'R')
        if not actual or actual['session_key'] != session_key:
            raise HTTPException(422, 'Race session identity does not match this Grand Prix.')
    cached = None if fresh else read_prepared_cache('race-native-v1', year, gp, session_key, driver_number)
    if cached is not None:
        return cached
    try:
        with ThreadPoolExecutor(max_workers=3, thread_name_prefix='race-native') as pool:
            jobs = {endpoint: pool.submit(openf1, endpoint, session_key=session_key, driver_number=driver_number)
                    for endpoint in ('car_data','location','laps')}
            streams = {endpoint: future.result() for endpoint, future in jobs.items()}
    except HTTPError as exc:
        if exc.code == 429:
            raise HTTPException(429, 'Native source rate limited. Keep cached race results and retry later.', headers={'Retry-After':'60'}) from exc
        raise HTTPException(502, 'Native race source is temporarily unavailable.') from exc
    laps = sorted(streams.pop('laps'), key=lambda r: integer(r.get('lap_number'), 0))
    columns = ['Distance','ElapsedSeconds','Speed','X','Y','SourceIntervalSeconds','PositionIntervalSeconds']
    output, errors = [], []
    for index, row in enumerate(laps):
        duration = seconds(row.get('lap_duration'))
        lap = integer(row.get('lap_number'), 0)
        if not lap or row.get('is_pit_out_lap') or duration is None or not 20 < duration < 300 or not row.get('date_start'):
            continue
        following = next((r for r in laps[index+1:index+2] if integer(r.get('lap_number')) == lap+1), {})
        try:
            samples = _openf1_lap_telemetry.__wrapped__(year,gp,'R',driver_number,lap,0,session_key,
                row['date_start'],duration,following.get('date_start'),streams=streams)
            if len(samples) < 30:
                errors.append({'lap':lap,'reason':'Too few native samples'}); continue
            output.append({'lap':lap,'time':duration,'points':[[p.get(c) for c in columns] for p in samples]})
        except Exception as exc:
            errors.append({'lap':lap,'reason':str(exc)})
    if not output:
        raise HTTPException(422, 'No native race laps returned for this driver.')
    payload = {'driver_number':driver_number,'session_key':session_key,'source':'OpenF1',
               'date':next((r.get('date_start') for r in laps if r.get('date_start')),None),
               'columns':columns,'laps':output,'errors':errors,'method':'native-race-streams-v1'}
    write_prepared_cache('race-native-v1', year, payload, gp, session_key, driver_number)
    return payload


@app.get('/api/performance/sprint')
def sprint_classification(response: Response, year: int = Query(..., ge=2021, le=2100),
                          gp: str = Query(..., min_length=3, max_length=120),
                          round: int = Query(..., ge=1, le=40), fresh: bool = False):
    """Points need a classification, not a download/parse of all sprint laps."""
    cached = None if fresh else read_prepared_cache('sprint-points-v1', year, gp, round)
    if cached is not None:
        return cached
    drivers, source = [], None
    try:
        request = URLRequest(f'https://api.jolpi.ca/ergast/f1/{year}/{round}/sprint/?limit=100',
                             headers={'User-Agent': 'euV2-data/1.0'})
        with urlopen(request, timeout=15) as upstream:
            races = json.load(upstream).get('MRData', {}).get('RaceTable', {}).get('Races', [])
        race = next((r for r in races if str(r.get('season')) == str(year)
                     and str(r.get('round')) == str(round)
                     and _normalised_name(r.get('raceName')) == _normalised_name(gp)), None)
        if race:
            drivers = [{'code': r.get('Driver', {}).get('code'), 'number': r.get('number'),
                        'team': r.get('Constructor', {}).get('name'),
                        'result': {'points': seconds(r.get('points'))}}
                       for r in race.get('SprintResults', [])]
            source = 'Jolpica sprint classification'
    except Exception as exc:
        logger.info('Sprint classification primary unavailable: %s', exc)
    if not drivers and year >= 2023:
        session = openf1_session(year, gp, 'S')
        if session:
            key = session['session_key']
            results = openf1('session_result', session_key=key)
            identities = {str(d['driver_number']): d for d in openf1('drivers', session_key=key)}
            drivers = [{'code': identities.get(str(r['driver_number']), {}).get('name_acronym'),
                        'number': str(r['driver_number']),
                        'team': identities.get(str(r['driver_number']), {}).get('team_name'),
                        'result': {'points': seconds(r.get('points'))}} for r in results]
            source = 'OpenF1 sprint classification'
    if not drivers or any(not d.get('code') or d['result']['points'] is None for d in drivers):
        raise HTTPException(422, 'Official sprint points are not available yet. Race points remain separate.')
    payload = {'event': gp, 'year': year, 'round': round, 'session': 'Sprint',
               'drivers': drivers, 'classification_complete': True, 'source': source}
    response.headers['Cache-Control'] = 'public, max-age=120'
    write_prepared_cache('sprint-points-v1', year, payload, gp, round)
    return payload


def load_openf1_performance(year, gp, session, fresh=False):
    """Recover the real alternate timing feeds when F1 archives are unavailable."""
    from openf1_performance import adapt_performance, retained_bundle
    retained = retained_bundle(year, gp, session)
    refresh_failed = False
    cached = read_prepared_cache('openf1-performance-v1', year, gp, session)
    bundle = None if fresh else cached
    if bundle is None and not fresh:
        bundle = retained
    if bundle is None:
        try:
            identity = openf1_session(year, gp, session)
            if identity is None:
                raise ValueError('No exact OpenF1 session for the selected event')
            endpoints = ('drivers', 'laps', 'stints', 'session_result', 'weather', 'race_control', 'pit')
            with ThreadPoolExecutor(max_workers=2, thread_name_prefix='openf1-performance') as pool:
                futures = {name: pool.submit(openf1_performance_feed, name, identity['session_key']) for name in endpoints}
                feeds = {name: future.result() for name, future in futures.items()}
            bundle = {'session': identity, 'feeds': feeds, 'captured_at': datetime.now(timezone.utc).isoformat()}
            # Validate before persisting; a failed/partial request cannot become a hit.
            data = adapt_performance(year, gp, session, bundle)
            write_prepared_cache('openf1-performance-v1', year, bundle, gp, session)
        except Exception:
            fallback = retained if retained is not None else cached
            if fallback is None:
                raise
            bundle, refresh_failed = fallback, True
            data = adapt_performance(year, gp, session, bundle)
    else:
        data = adapt_performance(year, gp, session, bundle)
    data.apex_source_notice = {'kind': 'openf1-timing', 'captured_at': bundle['captured_at'],
                              'refresh_failed': refresh_failed,
                              'retained': bundle is retained,
                              'expires_at': (datetime.fromisoformat(bundle['captured_at']) + timedelta(days=30)).isoformat() if bundle is retained else None,
                              'recorded_session_date': bundle['session']['date_start'],
                              'message': 'OpenF1 timing and classification. Race laps require complete sector timing, known dry tyres/weather and green race-control coverage. Lap-start timestamps are approximate.'}
    data.apex_source_bundle = bundle
    return data


def openf1_performance_feed(endpoint, session_key=None, **params):
    """A transient provider throttle must not become a permanent missing session."""
    for attempt in range(4):
        try:
            if session_key is not None:
                params['session_key'] = session_key
            return openf1(endpoint, **params)
        except HTTPError as error:
            if error.code not in (429, 502, 503, 504) or attempt == 3:
                raise
            try:
                retry_after = float(error.headers.get('Retry-After', 0))
            except (TypeError, ValueError, AttributeError):
                retry_after = 0
            time.sleep(min(30, max(2 ** (attempt + 1), retry_after)))


@app.get("/api/performance")
def car_performance(response: Response, year: int = Query(..., ge=2018, le=2100),
                    gp: str = Query(..., min_length=3, max_length=120),
                    session: str = Query('Q', pattern='^(Q|R)$'), fresh: bool = False):
    response.headers['Cache-Control'] = 'no-store'
    started = time.perf_counter()
    try:
        from performance import analyze
        from verified_sources import recorded_session, performance_input, source_notice
        from openf1_performance import retained_bundle
        recording = recorded_session(year, gp, session)
        recovered = recording if not fresh else None
        if recovered:
            data = performance_input(recovered)
        elif not fresh and (read_prepared_cache('openf1-performance-v1', year, gp, session) is not None
                            or retained_bundle(year, gp, session) is not None):
            data = load_openf1_performance(year, gp, session)
        else:
            try:
                data = load_fresh_session(year, gp, session)
                if data.laps.empty:
                    raise ValueError('Timing archive returned no laps')
            except Exception as archive_error:
                if not recording:
                    logger.info('Timing archive unavailable; trying OpenF1 for %s %s %s: %s', year, gp, session, archive_error)
                    data = load_openf1_performance(year, gp, session, fresh=fresh)
                else:
                    recovered = recording
                    data = performance_input(recovered)
        result = analyze(data, 2)
        if recovered:
            result['source_cache'] = source_notice(recovered)
            result['source_cache']['refresh_failed'] = fresh
        elif getattr(data, 'apex_source_notice', None):
            result['source_cache'] = data.apex_source_notice
    except Exception as exc:
        logger.warning('Car performance unavailable for %s %s: %s', year, gp, exc)
        if isinstance(exc, HTTPError) and exc.code in (429, 502, 503, 504):
            raise HTTPException(503, 'Timing source temporarily busy. Retrying shortly.',
                                headers={'Retry-After': '10'}) from exc
        raise HTTPException(422, 'Performance data is incomplete or unavailable for this session. Try another event.') from exc
    response.headers['Server-Timing'] = f'performance;dur={(time.perf_counter()-started)*1000:.1f}'
    return result


@app.get("/api/performance/pits")
def car_performance_pits(response: Response, year: int = Query(..., ge=2018, le=2100),
                         gp: str = Query(..., min_length=3, max_length=120), fresh: bool = False):
    """Fetch pit timing only when the user opens the pit-stop category."""
    def set_cache(source, visits, session=None):
        # Each Grand Prix has its own URL. A new race adds one new cache entry;
        # old races need not be recomputed to update season averages.
        ttl = 30 * 86400 if year < datetime.now(timezone.utc).year else 7 * 86400
        if session and session.get('date_end'):
            try:
                ended = datetime.fromisoformat(str(session['date_end']).replace('Z', '+00:00'))
                if ended.tzinfo is None:
                    ended = ended.replace(tzinfo=timezone.utc)
                if datetime.now(timezone.utc) - ended < timedelta(days=3):
                    ttl = 3600
            except ValueError:
                ttl = min(ttl, 3600)
        if not visits or (year >= 2023 and not source.startswith('OpenF1') and 'DHL stationary' not in source):
            ttl = min(ttl, 300)
        if visits and any(visit.get('stop_duration') is None for visit in visits):
            ttl = min(ttl, 300)
        response.headers['Cache-Control'] = (
            f'public, max-age={ttl}, s-maxage={ttl}, stale-while-revalidate={min(ttl, 86400)}'
        )

    started = time.perf_counter()
    from verified_sources import recorded_pits
    retained=recorded_pits(year,gp)
    if retained and not fresh:
        set_cache(retained.get('source','Recorded pit visits'),retained['visits'])
        return retained
    if year >= 2023:
        try:
            session = openf1_session(year, gp, 'R')
        except Exception as exc:
            logger.warning('OpenF1 pit session lookup unavailable for %s: %s',gp,exc)
            session = None
        if session and session.get('session_key') is not None:
            try:
                with ThreadPoolExecutor(max_workers=3) as pool:
                    pits_future = pool.submit(openf1, 'pit', session_key=session['session_key'])
                    drivers_future = pool.submit(openf1, 'drivers', session_key=session['session_key'])
                    stints_future = pool.submit(openf1, 'stints', session_key=session['session_key'])
                    control_future = pool.submit(openf1, 'race_control', session_key=session['session_key'])
                    pits = pits_future.result()
                    drivers = drivers_future.result()
                    try:
                        stints = stints_future.result()
                    except Exception:
                        stints = []
                    try:
                        controls = control_future.result()
                    except Exception:
                        controls = []
                if not drivers:
                    raise ValueError('Driver identities are unavailable')
                visits = openf1_pit_visits(pits, drivers, stints)
                source = 'OpenF1'
                supplement_status = None
                if year == 2026 and (not visits or any(v['stop_duration'] is None for v in visits)):
                    try:
                        stops = dhl_2026_pit_stops(session)
                        matched = merge_dhl_pit_stops(visits, drivers, stops, include_unmatched=True)
                        supplement_status = 'published' if stops else 'not-published'
                        if matched:
                            source = 'OpenF1 pit lane + DHL stationary'
                    except Exception as exc:
                        supplement_status = 'unavailable'
                        logger.warning('DHL stationary timing unavailable for %s: %s', gp, exc)
                visits = mark_penalty_stops(visits, controls)
                set_cache(source, visits, session)
                response.headers['Server-Timing'] = f'pits;dur={(time.perf_counter()-started)*1000:.1f}'
                return pit_timing_payload(gp,year,source,visits,drivers,session.get('date_start'),supplement_status)
            except Exception as exc:
                logger.warning('OpenF1 pit timing unavailable for %s %s: %s', year, gp, exc)

    try:
        data = load_fresh_session(year, gp, 'R')
        visits = fastf1_pit_visits(data.laps)
        drivers=[]
        for code in data.drivers:
            info=data.get_driver(code)
            drivers.append({'driver_number':str(info.get('DriverNumber',code)),
                            'name_acronym':str(info.get('Abbreviation') or ''),
                            'last_name':str(info.get('LastName') or ''),
                            'team_name':str(info.get('TeamName') or '')})
        race_date=utc_timestamp(data.date)
    except Exception as exc:
        logger.warning('Pit timing unavailable for %s %s: %s', year, gp, exc)
        recovered=recorded_pits(year,gp,allow_stale=True)
        if recovered:
            # Stationary publication is independent of the timing archive.
            # Keep retained lane visits, but still try to fill published box
            # stops by exact driver identity, race date and in-lap.
            if year==2026 and any(v['stop_duration'] is None for v in recovered['visits']):
                from verified_sources import recorded_session
                record=recorded_session(year,gp,'R',allow_stale=True)
                drivers=[{'driver_number':str(d['number']),'name_acronym':d['code'],
                          'last_name':d.get('name','').split()[-1] if d.get('name') else '',
                          'team_name':d['team']} for d in record['data']['drivers']]
                try:
                    stops=dhl_2026_pit_stops({'date_start':record['data']['date']})
                    matched=merge_dhl_pit_stops(recovered['visits'],drivers,stops,include_unmatched=True)
                    notice=recovered['source_cache']
                    recovered=pit_timing_payload(gp,year,'Recorded pit lane + DHL stationary' if matched else recovered.get('source','Recorded pit visits'),
                                                 recovered['visits'],drivers,record['data']['date'],'published' if stops else 'not-published')
                    recovered['source_cache']=notice
                except Exception as supplement_error:
                    logger.warning('DHL retained-visit supplement unavailable for %s: %s',gp,supplement_error)
            recovered['source_cache']['refresh_failed']=True
            response.headers['Cache-Control']='no-store'
            return recovered
        raise HTTPException(422, 'Pit timing is unavailable for this race.') from exc
    source='FastF1'
    supplement_status=None
    if year==2026 and race_date and (not visits or any(v['stop_duration'] is None for v in visits)):
        try:
            stops=dhl_2026_pit_stops({'date_start':race_date})
            matched=merge_dhl_pit_stops(visits,drivers,stops,include_unmatched=True)
            supplement_status='published' if stops else 'not-published'
            if matched:source='FastF1 pit lane + DHL stationary'
        except Exception as exc:
            supplement_status='unavailable'
            logger.warning('DHL stationary supplement unavailable for FastF1 %s: %s',gp,exc)
    set_cache(source, visits)
    response.headers['Server-Timing'] = f'pits;dur={(time.perf_counter()-started)*1000:.1f}'
    return pit_timing_payload(gp,year,source,visits,drivers,race_date,supplement_status)


DEVELOPMENT_MAX_BYTES, DEVELOPMENT_MAX_TEAMS, DEVELOPMENT_MAX_ROUNDS = 1_000_000, 30, 60


@app.post("/api/performance/development")
async def car_development_progression(request: Request, response: Response):
    response.headers['Cache-Control'] = 'no-store'
    try:
        from performance import compute_development_progression
        from api_security import limited_json
        payload = await limited_json(request, DEVELOPMENT_MAX_BYTES)
        teams = payload.get('teams', []) if isinstance(payload, dict) else None
        if not isinstance(teams, list) or len(teams) > DEVELOPMENT_MAX_TEAMS:
            raise HTTPException(422, 'Invalid development request')
        results = {}
        for team_data in teams:
            team_name = team_data.get('team') if isinstance(team_data, dict) else None
            rounds = team_data.get('rounds', []) if isinstance(team_data, dict) else None
            if not isinstance(team_name, str) or len(team_name) > 100 or not isinstance(rounds, list)                     or len(rounds) > DEVELOPMENT_MAX_ROUNDS or not all(isinstance(r, dict) for r in rounds):
                raise HTTPException(422, 'Invalid development request')
            results[team_name] = compute_development_progression(rounds)
        return {'results': results}
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning('Development progression calculation failed: %s', exc)
        raise HTTPException(422, 'Development progression calculation failed') from exc


@app.get('/api/performance/trace')
def car_performance_trace(response: Response, year: int = Query(..., ge=2018, le=2100),
                          gp: str = Query(..., min_length=3, max_length=120),
                          driver_number: str = Query(..., pattern=r'^\d{1,3}$'),
                          start: float = Query(..., ge=0, le=20000),
                          end: float = Query(..., gt=0, le=20300)):
    response.headers['Cache-Control'] = 'no-store'
    if not 20 < end-start < 300:
        raise HTTPException(422, 'Invalid qualifying lap window')
    try:
        fastf1_runtime()
        from session_loader import load_selected_lap_telemetry, exact_event, download_feed, _PARSERS
        from fastf1.mvapi import get_circuit_info
        from performance import telemetry_metrics
        samples = load_selected_lap_telemetry(year, gp, 'Q', driver_number, start, end)
        lap_session = exact_event(year, gp).get_session('Q')
        session_info = _PARSERS['session_info'](lap_session.api_path,
            response=download_feed(lap_session.api_path, 'session_info'))
        circuit = session_info['Meeting']['Circuit']
        key = 146 if circuit.get('Key') == 149 and circuit.get('ShortName') == 'Mugello' else circuit['Key']
        info = get_circuit_info(year=year, circuit_key=key)
        corners = [{'number': str(r['Number']), 'letter': str(r.get('Letter') or ''),
                    'x': seconds(r.get('X')), 'y': seconds(r.get('Y'))}
                   for _, r in info.corners.iterrows()] if info is not None else []
        return telemetry_metrics(samples, corners)
    except Exception as exc:
        logger.warning('Performance trace unavailable: %s', exc)
        raise HTTPException(422, 'This lap has insufficient telemetry or circuit geometry for performance analysis.') from exc


@app.get('/api/performance/trace-batch')
def car_performance_trace_batch(response: Response, year: int = Query(..., ge=2018, le=2100),
                                gp: str = Query(..., min_length=3, max_length=120),
                                windows: str = Query(..., min_length=20, max_length=36000),
                                measures: str = Query('all', pattern='^(all|speed)$')):
    """Extract all team representatives from one shared qualifying archive."""
    response.headers['Cache-Control'] = 'no-store'
    try:
        selections = json.loads(windows)
        if not isinstance(selections, list) or not 1 <= len(selections) <= 72:
            raise ValueError('one to thirty-six candidate windows are required')
        normalized = []
        for item in selections:
            team = str(item.get('team') or '')[:80]
            number = str(item.get('driver_number') or '')
            start, end = float(item.get('start')), float(item.get('end'))
            if not team or not number.isdigit() or not 20 < end-start < 300:
                raise ValueError('invalid team telemetry window')
            official_time = float(item.get('time'))
            if not 20 < official_time < 300 or abs(official_time - (end-start)) > 1.5:
                raise ValueError('official lap time does not match the telemetry window')
            normalized.append({'team': team, 'team_name': str(item.get('team_name') or team)[:80],
                               'driver_number': number, 'driver': str(item.get('driver') or number)[:4],
                               'lap': item.get('lap'), 'time': official_time,
                               'sectors': item.get('sectors'),
                               'compound': item.get('compound'), 'phase': item.get('phase'),
                               'qualifying_best_time': float(item.get('qualifying_best_time') or official_time),
                               'qualifying_best_driver': str(item.get('qualifying_best_driver') or item.get('driver') or number)[:4],
                               'qualifying_best_lap': item.get('qualifying_best_lap', item.get('lap')),
                               'start': start, 'end': end,
                               'speed_st': item.get('speed_st'),
                               'speed_fl': item.get('speed_fl')})
        from verified_sources import recorded_session, recorded_lap, source_notice
        recording = recorded_session(year, gp, 'Q')
        retained = [None]*len(normalized)
        if recording:
            retained = [recorded_lap(recording, driver=s['driver'], number=s['driver_number'],
                                     lap=s['lap'], start=s['start'], end=s['end'], duration=s['time'])
                        for s in normalized]
            if all(retained):
                from performance_tracks import measure_field, speed_domain_only
                extracted = [(s['team'], r['samples'], None) for s, r in zip(normalized, retained)]
                measure = speed_domain_only if measures == 'speed' else measure_field
                return {'event':gp, 'source_cache':source_notice(recording), 'fusion':{},
                        **measure(extracted, normalized, recording.get('corners', []))}
        fastf1_runtime()
        from session_loader import load_selected_laps_telemetry, exact_event, download_feed, _PARSERS
        from fastf1.mvapi import get_circuit_info
        from performance_tracks import measure_field
        # Circuit key from the F1 archive, else OpenF1 (the archive has
        # returned HTTP 401); markers are optional for the speed-domain metrics.
        circuit = {}
        try:
            if not archive_usable(year, gp, 'Q'):
                raise RuntimeError('timing archive skipped')
            event = exact_event(year, gp)
            lap_session = event.get_session('Q')
            session_info = _PARSERS['session_info'](lap_session.api_path,
                response=download_feed(lap_session.api_path, 'session_info'))
            circuit = session_info['Meeting']['Circuit']
        except Exception as archive_error:
            if str(archive_error) != 'timing archive skipped':
                mark_archive_unusable(year, gp, 'Q')
            logger.info('Session info unavailable for %s; using OpenF1 circuit key: %s', gp, archive_error)
            lookup = openf1_session(year, gp, 'Q') if year >= 2023 else None
            if lookup and lookup.get('circuit_key') is not None:
                circuit = {'Key': lookup['circuit_key'], 'ShortName': lookup.get('circuit_short_name')}
        corners = list((recording or {}).get('corners') or [])
        if not corners and circuit.get('Key') is not None:
            try:
                key = 146 if circuit.get('Key') == 149 and circuit.get('ShortName') == 'Mugello' else circuit['Key']
                info = get_circuit_info(year=year, circuit_key=key)
                corners = [{'number': str(r['Number']), 'letter': str(r.get('Letter') or ''),
                            'x': seconds(r.get('X')), 'y': seconds(r.get('Y'))}
                           for _, r in info.corners.iterrows()] if info is not None else []
            except Exception as exc:
                logger.info('Circuit markers unavailable for %s: %s', gp, exc)
        # Recordings usually hold one lap per team; a driver view asks for
        # both drivers. Reuse every recorded lap and fetch only the rest, from
        # OpenF1 when the F1 archive refuses (it has returned HTTP 401), so a
        # single missing lap no longer fails the whole batch.
        missing = [s for s, r in zip(normalized, retained) if not r]
        fetched = {}
        if missing:
            try:
                if not archive_usable(year, gp, 'Q'):
                    raise RuntimeError('timing archive skipped')
                fetched = {id(s): entry for s, entry in zip(missing, load_selected_laps_telemetry(year, gp, 'Q', missing))}
            except Exception as archive_error:
                if str(archive_error) != 'timing archive skipped':
                    mark_archive_unusable(year, gp, 'Q')
                logger.info('Timing archive unavailable for %s Q laps; using OpenF1: %s', gp, archive_error)
                lookup = openf1_session(year, gp, 'Q') if year >= 2023 else None
                key = lookup.get('session_key') if lookup else None
                def from_openf1(s):
                    try:
                        samples = _openf1_lap_telemetry(year, gp, 'Q', s['driver_number'], int(s['lap']),
                                                        0, key)
                        return s['team'], samples, None if samples else 'No OpenF1 telemetry for this lap'
                    except Exception as exc:
                        return s['team'], None, str(exc)[:160]
                from concurrent.futures import ThreadPoolExecutor as LapPool
                with LapPool(max_workers=2) as pool:
                    fetched = {id(s): entry for s, entry in zip(missing, pool.map(from_openf1, missing))}
        extracted = [(s['team'], r['samples'], None) if r else fetched[id(s)] for s, r in zip(normalized, retained)]
        # The feeds usually contain the same upstream packets. Fetch a
        # complement only for incomplete traces; never interlace duplicates
        # into a fictitious higher sample frequency.
        from telemetry_sources import needs_complement, fuse_native_samples
        fusion={}
        if year>=2023 and any(needs_complement(samples or []) for _,samples,_ in extracted):
            try:
                lookup=openf1_session(year,gp,'Q');session_key=lookup.get('session_key') if lookup else None
                selections_by_key={s['team']:s for s in normalized}
                recovery_keys={key for key,samples,_ in extracted if samples and needs_complement(samples)}
                attempted=set(sorted(recovery_keys)[:3])
                fusion.update({key:{'status':'not-attempted-recovery-budget','reason':'Maximum three source recoveries per batch; native evidence retained'} for key in recovery_keys-attempted})
                def complement(entry):
                    key,samples,error=entry
                    if key not in attempted:return entry
                    s=selections_by_key[key]
                    try:
                        other=_openf1_lap_telemetry(year,gp,'Q',s['driver_number'],int(s['lap']),int(time.time()//30) if year>=datetime.now().year else 0,session_key)
                        combined,report=fuse_native_samples(samples,other);fusion[key]=report
                        return key,combined,error
                    except Exception as exc:
                        fusion[key]={'status':'secondary-unavailable','reason':str(exc)[:160]};return entry
                if session_key:
                    from concurrent.futures import ThreadPoolExecutor
                    with ThreadPoolExecutor(max_workers=3) as pool:extracted=list(pool.map(complement,extracted))
            except Exception as exc:
                fusion['status']='secondary-unavailable'
        if not circuit.get('Key') and not corners and year >= 2023:
            # Archive metadata can be disabled while OpenF1 telemetry works.
            # Keep the circuit identity so the verified map fallback still runs.
            identity = openf1_session(year, gp, 'Q')
            circuit['Key'] = (identity or {}).get('circuit_key')
        if circuit.get('Key') == 12 and not corners:
            # Official Sepang map positions, projected onto this lap's GPS.
            # Event name may still be Bahrain in the upstream test calendar.
            positions = [(0,.477778),(.094181,.517310),(.070923,.785614),(.479518,.992982),
                         (.604422,.655322),(.774407,.745614),(1,.466316),(.957504,.364211),
                         (.547569,.291813),(.638783,.175322),(.572071,0),(.338821,.200585),
                         (.162902,.151111),(.095616,.249942),(.858059,.488187)]
            corners = [{'number': str(i+1), 'x': x, 'y': y, 'normalized': True}
                       for i, (x, y) in enumerate(positions)]
        from performance_tracks import speed_domain_only
        measure = speed_domain_only if measures == 'speed' else measure_field
        return {'event': gp, 'fusion':fusion, **measure(extracted, normalized, corners)}
    except HTTPError as exc:
        if exc.code in (408, 429, 502, 503, 504):
            raise HTTPException(503, 'Telemetry archive is temporarily busy. Please retry shortly.') from exc
        raise HTTPException(422, 'Telemetry archive is unavailable for this selection.') from exc
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(422, f'Invalid telemetry selection: {exc}') from exc
    except Exception as exc:
        logger.warning('Batch performance trace unavailable for %s: %s', gp, exc)
        raise HTTPException(422, 'This event has insufficient telemetry or circuit geometry for performance analysis.') from exc


@app.get("/api/telemetry")
def telemetry(
    response: Response,
    year: int = Query(2025, ge=2014),
    gp: str = Query("British Grand Prix"),
    round: int | None = Query(None, ge=1),
    session: str = Query("Q"),
    driver: str = Query(..., min_length=2),
    lap: int = Query(..., ge=1),
    driver_number: str | None = Query(None, pattern=r"^\d{1,3}$"),
    session_key: int | None = Query(None, ge=1),
    fresh: bool = Query(False),
    geometry: bool = Query(False),
    lap_start: datetime | None = Query(None),
    lap_time: float | None = Query(None, gt=20, lt=300),
    next_start: datetime | None = Query(None),
    lap_start_seconds: float | None = Query(None, ge=0),
    lap_end_seconds: float | None = Query(None, gt=0),
    pit_out: bool = False,
):
    started = time.perf_counter()
    if year < 2018:
        raise HTTPException(422, "Detailed speed and input telemetry is not published before 2018.")
    for timestamp in (lap_start, next_start):
        if timestamp is not None and (timestamp.year != year or timestamp.tzinfo is None):
            raise HTTPException(422, "Lap timestamps must be timezone-aware and match the selected year.")
    cache_parts = (gp, round, session, driver.upper(), lap) + (("pit_out_v3",) if pit_out else ())
    cached = None if fresh else read_prepared_cache("telemetry", year, *cache_parts)
    # Older/current OpenF1 responses may contain all car channels but no
    # location packets. Returning that cache entry immediately permanently
    # suppresses the FastF1 position fallback and leaves the track map blank.
    # Complete payloads are safe to return; incomplete ones remain a last-resort
    # speed fallback while we try to obtain the circuit geometry below.
    incomplete_openf1: tuple[list[dict[str, Any]], list[dict[str, Any]]] | None = None
    if cached is not None and cached.get("position_complete") is not False:
        return cached
    if cached is not None:
        incomplete_openf1 = (
            cached.get("samples") or [],
            cached.get("corners") or [],
        )
        response.headers["Cache-Control"] = "no-store, max-age=0"

    def finish(samples: list[dict[str, Any]], projected_corners: list[dict[str, Any]], source: str, recording=None):
        from telemetry_sources import annotate_samples, fuse_native_samples
        fusion=None
        if incomplete_openf1 and source.startswith('FastF1'):
            samples,fusion=fuse_native_samples(samples,incomplete_openf1[0])
        else:
            samples=annotate_samples(samples,source)
        response.headers["Server-Timing"] = f'telemetry;dur={(time.perf_counter()-started)*1000:.1f}'
        response.headers["Timing-Allow-Origin"] = "*"
        position_coverage, position_complete = position_geometry_quality(samples)
        payload = {
            "driver": driver,
            "lap": lap,
            "samples": samples,
            "corners": projected_corners,
            "source": source,
            "position_coverage": position_coverage,
            "position_usable": position_coverage >= .55,
            "position_complete": position_complete,
            "fusion":fusion,
            "sampling_evidence":{'native_packets':sum(not p.get('IsInterpolatedBoundary',False) for p in samples),
                                 'derived_boundary_points':sum(bool(p.get('IsInterpolatedBoundary')) for p in samples)},
        }
        if recording:
            from verified_sources import source_notice
            payload['source_cache'] = source_notice(recording)
            payload['source_cache']['refresh_failed'] = fresh
        # Do not freeze an incomplete current OpenF1 location stream. Keep the
        # useful speed response, but force the next request back to the source.
        if fresh:
            response.headers["Cache-Control"] = "no-store"
        elif position_complete or year < datetime.now().year:
            write_prepared_cache("telemetry", year, payload, *cache_parts)
        else:
            response.headers["Cache-Control"] = "no-store, max-age=0"
        return payload

    from verified_sources import recorded_session, recorded_lap
    recording = recorded_session(year, gp, session) if not pit_out else None
    retained = recorded_lap(recording, driver=driver, number=driver_number, lap=lap,
                            start=lap_start_seconds, end=lap_end_seconds, duration=lap_time) if recording else None
    if retained and not fresh:
        return finish(retained['samples'], retained.get('corners',[]), 'Recorded native '+('race' if session=='R' else 'qualifying')+' lap', recording)

    # For a pit-out lap, the session's exact pit-exit timestamp is the start.
    # OpenF1's lap start/duration may cover a different interval and cannot
    # safely replace this segment even when its location stream is complete.
    if pit_out and year >= 2023 and driver_number:
        try:
            lookup = openf1_session(year, gp, session)
            key = session_key or (lookup.get("session_key") if lookup else None)
            if key:
                rows = openf1("laps", session_key=key, driver_number=driver_number,
                              **{"lap_number>=": lap, "lap_number<=": lap + 1})
                current = next((row for row in rows if integer(row.get("lap_number"), -1) == lap), None)
                following = next((row for row in rows if integer(row.get("lap_number"), -1) == lap + 1), None)
                start = _parse_openf1_datetime(current.get("date_start")) if current else None
                end = _parse_openf1_datetime(following.get("date_start")) if following else None
                duration = (end - start).total_seconds() if start and end else None
                if duration is None or not 20 < duration < 300 or (lap_time is not None
                        and abs(duration - lap_time) > 5):
                    raise ValueError("Pit-out timing boundaries are not supported")
                retrieve = _openf1_lap_telemetry.__wrapped__ if fresh else _openf1_lap_telemetry
                samples = retrieve(year, gp, session, driver_number, lap,
                                   int(time.time()//30) if year >= datetime.now().year else 0,
                                   key, start.isoformat(), duration, end.isoformat())
                if samples and max((seconds(point.get("Speed")) or 0) for point in samples) > 30:
                    return finish(samples, [], "OpenF1 pit-out segment")
        except Exception as pit_out_openf1_error:
            logger.debug("Pit-out OpenF1 segment unavailable for %s L%s: %s",
                         driver, lap, pit_out_openf1_error)

    if (pit_out and driver_number and lap_start_seconds is not None
            and lap_end_seconds is not None and lap_end_seconds > lap_start_seconds):
        try:
            from session_loader import load_selected_lap_telemetry
            samples = load_selected_lap_telemetry(
                year, gp, session, driver_number, lap_start_seconds, lap_end_seconds,
            )
            if samples:
                return finish(samples, [], "FastF1 pit-out segment")
        except Exception as pit_out_error:
            logger.debug("Pit-out archive unavailable for %s L%s: %s", driver, lap, pit_out_error)

    # OpenF1 can provide recent laps individually, including position data for
    # the dominance map. It avoids loading every car in the FastF1 session.
    try:
        if year >= 2023 and not geometry and not pit_out:
            if session_key is None:
                lookup = openf1_session(year, gp, session)
                session_key = lookup.get("session_key") if lookup else None
            if not driver_number and session_key:
                rows = openf1("drivers", session_key=session_key)
                driver_number = next((str(row["driver_number"]) for row in rows
                                      if str(row.get("name_acronym", "")).upper() == driver.upper()), None)
            if not driver_number or not session_key:
                raise ValueError("No matching OpenF1 driver/session")
            # No FastF1 session load or disk/LRU response lookup on this path.
            retrieve = _openf1_lap_telemetry.__wrapped__ if fresh else _openf1_lap_telemetry
            samples = retrieve(year, gp, session, driver_number, lap,
                               int(time.time()//30) if year >= datetime.now().year else 0, session_key,
                               lap_start.isoformat() if lap_start else None, lap_time,
                               next_start.isoformat() if next_start else None)
            if samples:
                # The client already has corner metadata from session loading.
                projected = []
                positioned = sum(
                    point.get("X") is not None and point.get("Y") is not None
                    for point in samples
                )
                if fresh or positioned / max(1, len(samples)) >= 0.55:
                    return finish(samples, projected, "OpenF1")
                # Keep OpenF1's car channels available, but prefer FastF1 when
                # it can supply the missing X/Y stream required by the map.
                incomplete_openf1 = (samples, projected)
    except Exception as openf1_lookup_error:
        # An OpenF1 rate limit is not evidence that the lap is unavailable.
        # Try the independent FastF1 selected-lap archive below before failing.
        logger.debug("OpenF1 lookup unavailable for %s L%s: %s", driver, lap, openf1_lookup_error)

    # Historical timing archives are session-wide. When the session response
    # supplied exact lap boundaries, decode only this driver/window instead of
    # constructing telemetry frames for every driver and every lap.
    if (not pit_out and driver_number and lap_start_seconds is not None and lap_end_seconds is not None
            and lap_end_seconds > lap_start_seconds):
        try:
            from session_loader import load_selected_lap_telemetry
            samples = load_selected_lap_telemetry(
                year, gp, session, driver_number,
                lap_start_seconds, lap_end_seconds,
            )
            if samples:
                return finish(samples, [], "FastF1 selected lap")
        except Exception as selected_lap_error:
            logger.debug("Selected-lap archive path unavailable for %s L%s: %s",
                         driver, lap, selected_lap_error)

    try:
        data = (load_fresh_session(year, gp, session, telemetry=True) if fresh
                else load_telemetry_session(year, gp, session))
        driver_info = data.get_driver(driver)
        driver_number = str(driver_info.get("DriverNumber", driver))
        selected = data.laps.pick_drivers(driver_number)
        selected = selected[np.isclose(selected["LapNumber"].astype(float), float(lap))]
        if selected.empty:
            raise ValueError("lap was not found")
        lap_row = selected.iloc[0]
        # Pit laps are useful for comparing car inputs. Their available segment
        # may be partial, so the client labels them IN/OUT and does not treat
        # an estimated pit-exit duration as an official lap time.
        # Use the raw car stream for the trace. FastF1's convenience
        # get_telemetry() helper merges position and car channels, which can
        # introduce interpolated/padded samples around some laps.
        telemetry_data = lap_row.get_car_data().add_distance().copy()
        pit_out_time = seconds(lap_row.get("PitOutTime"))
        if pit_out_time is not None and "Time" in telemetry_data.columns:
            telemetry_data = telemetry_data[
                telemetry_data["Time"].dt.total_seconds() >= pit_out_time - .25
            ].copy()
        try:
            position_data = lap_row.get_pos_data().loc[:, ["Date", "X", "Y"]].copy()
            telemetry_data = pd.merge_asof(
                telemetry_data.sort_values("Date"),
                position_data.sort_values("Date"),
                on="Date",
                direction="nearest",
                tolerance=pd.Timedelta(milliseconds=300),
            )
        except Exception as position_error:
            logger.warning("Position join unavailable for %s L%s: %s", driver, lap, position_error)
        for coordinate in ("X", "Y"):
            if coordinate not in telemetry_data.columns:
                telemetry_data[coordinate] = np.nan

        # Keep only the official lap-time interval as a final guard.
        official_lap_time = seconds(lap_row.get("LapTime"))
        if official_lap_time and "Time" in telemetry_data.columns:
            elapsed = telemetry_data["Time"].dt.total_seconds()
            telemetry_data = telemetry_data[
                (elapsed >= -0.25) & (elapsed <= official_lap_time + 0.25)
            ].copy()
        if telemetry_data.empty:
            raise ValueError("lap telemetry was empty after official-time trimming")
        telemetry_data["Distance"] = telemetry_data["Distance"] - telemetry_data["Distance"].iloc[0]
    except Exception as fastf1_error:
        logger.debug("FastF1 telemetry unavailable for %s L%s: %s", driver, lap, fastf1_error)
        if retained:
            return finish(retained['samples'], retained.get('corners',[]), 'Recorded native '+('race' if session=='R' else 'qualifying')+' lap', recording)
        if incomplete_openf1 and incomplete_openf1[0]:
            return finish(incomplete_openf1[0], incomplete_openf1[1], "OpenF1")
        try:
            data = load_session(year, gp, session, round)
            driver_number = str(data.get_driver(driver).get("DriverNumber", driver))
            samples = [] if pit_out else openf1_lap_telemetry(year, gp, session, driver_number, lap)
            if samples:
                return finish(samples, project_corners_onto_lap(data, samples), "OpenF1")
        except Exception as openf1_error:
            logger.warning("OpenF1 telemetry fallback unavailable for %s L%s: %s", driver, lap, openf1_error)
            raise HTTPException(422, f"No telemetry source returned this lap. FastF1: {fastf1_error}; OpenF1: {openf1_error}") from openf1_error
        raise HTTPException(422, "No telemetry is published for this session/lap yet.")

    telemetry_data = telemetry_data.copy()
    telemetry_data["ElapsedSeconds"] = telemetry_data["Time"].dt.total_seconds()
    telemetry_data["Timestamp"] = telemetry_data["Date"].map(
        lambda value: pd.Timestamp(value).timestamp() if pd.notna(value) else None)
    columns = ["Distance", "ElapsedSeconds", "Timestamp", "Speed", "Throttle", "Brake", "RPM", "nGear", "DRS", "X", "Y"]
    # FastF1 car data is already a low-rate official timing stream. Keep every
    # published row; a second 4x downsample made braking traces visibly coarse.
    samples = telemetry_data[columns].replace({np.nan: None}).to_dict("records")
    if samples:
        return finish(samples, project_corners_onto_lap(data, samples), "FastF1")

    try:
        samples = [] if pit_out else openf1_lap_telemetry(year, gp, session, driver_number, lap)
        if samples:
            return finish(samples, project_corners_onto_lap(data, samples), "OpenF1")
    except Exception:
        pass
    raise HTTPException(422, "No telemetry is published for this session/lap yet. Try a completed session or a 2023+ event with OpenF1 coverage.")


ASSETS_DIR = ROOT / "assets"
if ASSETS_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")


@app.get("/")
def frontend_index() -> FileResponse:
    if os.environ.get('VERCEL'):
        return RedirectResponse('https://f1apexdata.eufrandota14.chatgpt.site/apex/')
    return FileResponse(ROOT / "index.html")


@app.get("/{asset_name}")
def frontend_asset(asset_name: str) -> FileResponse:
    """Serve only the browser bundle, never backend source or deployment files."""
    if os.environ.get('VERCEL'):
        raise HTTPException(404, 'Frontend assets are served by the site host.')
    # Browser scripts and styles sit at the repository root; backend source, configuration
    # and deployment files have other extensions and are never served.
    if not re.fullmatch(r"[A-Za-z0-9_-]+\.(js|css)", asset_name) or not (ROOT / asset_name).is_file():
        raise HTTPException(404, "Not found")
    return FileResponse(ROOT / asset_name)
