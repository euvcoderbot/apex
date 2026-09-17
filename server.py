"""FastF1 and OpenF1 API for euV2 data."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from bisect import bisect_left, bisect_right
from functools import lru_cache
from datetime import datetime, timedelta, timezone
import gzip
import hashlib
import logging
import json
import os
from pathlib import Path
import time
import math
import importlib
from typing import Any
from urllib.request import Request as URLRequest, urlopen
from urllib.error import HTTPError
from uuid import uuid4

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
PREPARED_CACHE_VERSION = "v5"
SESSION_CACHE_SCHEMA = "session-identity-weather-v5"

app = FastAPI(title="euV2 data API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET"],
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


def load_fresh_session(year, gp, session, telemetry=False):
    fastf1_runtime()
    from session_loader import load_fresh_session as load
    return load(year, gp, session, telemetry=telemetry)


@app.get("/api/health")
def health() -> dict[str, str]:
    """Lightweight hosting health check that never downloads F1 data."""
    return {"status": "ok"}


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
    logger.exception("Unhandled error serving %s", request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal server error: {type(error).__name__}: {error}"},
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


def read_prepared_cache(namespace: str, year: int, *parts: Any) -> Any | None:
    path = prepared_cache_path(namespace, year, *parts)
    if not path.exists():
        return None
    # Upstream classifications and lap feeds can be reprocessed after a
    # session (and, occasionally, after a season). Current data refreshes
    # quickly; historical session/telemetry payloads get a weekly revalidation
    # instead of being treated as immutable forever.
    age = time.time() - path.stat().st_mtime
    if year >= datetime.now().year and age > 600:
        return None
    if namespace in {"session", "telemetry"} and age > 7 * 86400:
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


def openf1(endpoint: str, **params: Any) -> list[dict[str, Any]]:
    from urllib.parse import quote
    valid_params = {key: value for key, value in params.items() if value is not None}
    parts = []
    for key, value in valid_params.items():
        if key.endswith(">=") or key.endswith("<=") or key.endswith(">") or key.endswith("<"):
            parts.append(f"{key}{quote(str(value))}")
        else:
            parts.append(f"{key}={quote(str(value))}")
    query = "&".join(parts)
    request = URLRequest(
        f"{OPENF1}/{endpoint}?{query}",
        headers={"Accept-Encoding": "gzip", "User-Agent": "euV2-data/1.0"},
    )
    with urlopen(request, timeout=20) as response:
        body = response.read()
        if response.headers.get("Content-Encoding", "").lower() == "gzip":
            body = gzip.decompress(body)
        return json.loads(body.decode("utf-8"))


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


@lru_cache(maxsize=64)
def openf1_session(year: int, gp: str, session_name: str) -> dict[str, Any] | None:
    try:
        meetings = openf1("meetings", year=year)
        meeting = _openf1_meeting(year, gp, meetings)
        if meeting is None or meeting.get("meeting_key") is None:
            return None
        sessions = openf1("sessions", year=year, meeting_key=meeting["meeting_key"])
        wanted_session = session_name.lower().strip()
        
        for item in sessions:
            name = item.get("session_name", "").lower().strip()
            if wanted_session == name:
                return item
            if wanted_session == 'q' and 'qualifying' in name:
                return item
            if wanted_session == 'r' and 'race' in name:
                return item
            if wanted_session == 'fp1' and 'practice 1' in name:
                return item
            if wanted_session == 'fp2' and 'practice 2' in name:
                return item
            if wanted_session == 'fp3' and 'practice 3' in name:
                return item
            if wanted_session == 's' and 'sprint' in name and 'qualifying' not in name:
                return item
            if wanted_session == 'sq' and ('sprint qualifying' in name or 'sprint shootout' in name):
                return item
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
                    and all(0 < b['ElapsedSeconds'] - a['ElapsedSeconds'] <= 1.25
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
        result.append({**point, 'x': position.get('x'), 'y': position.get('y')})
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
        driver_laps = openf1("laps", session_key=session_key, driver_number=driver_number,
                             **{"lap_number>=": lap_number, "lap_number<=": lap_number+1})
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
            source = dict(before or after)
            source["date"] = boundary.isoformat().replace("+00:00", "Z")
            return source

        before_time = datetime.fromisoformat(before["date"].replace('Z', '+00:00'))
        after_time = datetime.fromisoformat(after["date"].replace('Z', '+00:00'))
        span = (after_time - before_time).total_seconds()
        ratio = 0.0 if span <= 0 else (boundary - before_time).total_seconds() / span
        ratio = max(0.0, min(1.0, ratio))
        result = dict(before if ratio < 0.5 else after)
        result["date"] = boundary.isoformat().replace("+00:00", "Z")

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
            "Speed": current_speed,
            "Throttle": point.get("throttle"),
            "Brake": point.get("brake"),
            "RPM": point.get("rpm"),
            "nGear": point.get("n_gear"),
            "DRS": point.get("drs"),
            "X": point.get("x"),
            "Y": point.get("y"),
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
    event = exact_fastf1_event(year, gp, backend=backend)

    session = event.get_session(session_name)
    # Session controls need timing/lap data, not the multi-megabyte car stream
    # for every driver. Fetch the car stream only if OpenF1 cannot provide a
    # selected lap (mainly older seasons).
    session.load(laps=True, telemetry=False, weather=True, messages=False)
    return session


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
            "date": str(event["EventDate"])[:10],
            "sessions": sessions,
            "session_dates": session_dates,
        })
    enrich_recent_openf1_statuses(year, result)
    return result


def get_tire_nominations(year: int, gp: str) -> list[str]:
    # Standard Pirelli dry slick compound allocations for common Grand Prix
    name = gp.lower()
    
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
    for fallback_year in range(first_fallback_year, max(2017, first_fallback_year - 3), -1):
        try:
            fb_event = exact_fastf1_event(
                fallback_year, gp, location=current_location
            )
            if fb_event is not None:
                fallback_location = str(fb_event.get("Location") or "").strip().casefold()
                if (normalized_location and fallback_location
                        and normalized_location != fallback_location):
                    continue
                fb_sess = fb_event.get_session(session_name)
                fb_sess.load(laps=True, telemetry=False, weather=False, messages=False)
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
    for _, row in marker_rows.iterrows():
        x, y = seconds(row.get("X")), seconds(row.get("Y"))
        if x is None or y is None:
            continue
        nearest = min(points, key=lambda point: (seconds(point["X"]) - x) ** 2 + (seconds(point["Y"]) - y) ** 2)
        fraction = seconds(nearest.get("Distance")) / total_distance
        if not 0 < fraction <= 1:
            continue
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
def events(year: int = Query(2025, ge=2014)):
    cached = read_prepared_cache("events", year)
    if cached is not None:
        return cached
    try:
        result = event_calendar(year)
    except Exception as exc:
        raise HTTPException(422, str(exc)) from exc
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
            if laps:
                result.append({
                    "code": acronym,
                    "number": str(d_num),
                    "name": full_name,
                    "team": team_name,
                    "team_color": team_color,
                    "position": result_positions.get(integer(d_num, -1)),
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
        return cached
    try:
        data = load_fresh_session(year, gp, session) if fresh else load_session(year, gp, session, round)
    except Exception as exc:
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
                                "lap_start_seconds": seconds(row.get("LapStartTime")),
                                "lap_end_seconds": seconds(row.get("Time")),
                                "time": seconds(row["LapTime"]),
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
                "laps": laps_list,
            })
        except Exception as driver_err:
            logger.warning("Could not parse driver %s: %s", code, driver_err)

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

    payload = {
        "event": data.event["EventName"],
        "session": data.name,
        "date": session_date_iso,
        "drivers": drivers,
        "corners": corners,
        "circuit_rotation": circuit_rotation,
        "compounds": get_tire_nominations(year, gp),
        "openf1_session_key": integer(getattr(data, "session_info", {}).get("Key"), 0) or None,
        "lap_data_complete": lap_data_complete,
    }
    response.headers['Server-Timing'] = f'session;dur={(time.perf_counter()-started)*1000:.1f}'
    response.headers['Timing-Allow-Origin'] = '*'
    if drivers and lap_data_complete and not fresh:
        write_prepared_cache("session", year, payload, SESSION_CACHE_SCHEMA, gp, round, session)
    return payload


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
):
    started = time.perf_counter()
    if year < 2018:
        raise HTTPException(422, "Detailed speed and input telemetry is not published before 2018.")
    for timestamp in (lap_start, next_start):
        if timestamp is not None and (timestamp.year != year or timestamp.tzinfo is None):
            raise HTTPException(422, "Lap timestamps must be timezone-aware and match the selected year.")
    cache_parts = (gp, round, session, driver.upper(), lap)
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

    def finish(samples: list[dict[str, Any]], projected_corners: list[dict[str, Any]], source: str):
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
        }
        # Do not freeze an incomplete current OpenF1 location stream. Keep the
        # useful speed response, but force the next request back to the source.
        if fresh:
            response.headers["Cache-Control"] = "no-store"
        elif position_complete or year < datetime.now().year:
            write_prepared_cache("telemetry", year, payload, *cache_parts)
        else:
            response.headers["Cache-Control"] = "no-store, max-age=0"
        return payload

    # OpenF1 can provide recent laps individually, including position data for
    # the dominance map. It avoids loading every car in the FastF1 session.
    try:
        if year >= 2023 and not geometry:
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
        if isinstance(openf1_lookup_error, HTTPError) and openf1_lookup_error.code in (429, 502, 503, 504):
            raise HTTPException(503, "Telemetry provider is busy. Please retry shortly.") from openf1_lookup_error
        logger.debug("OpenF1 lookup unavailable for %s L%s: %s", driver, lap, openf1_lookup_error)

    # Historical timing archives are session-wide. When the session response
    # supplied exact lap boundaries, decode only this driver/window instead of
    # constructing telemetry frames for every driver and every lap.
    if (driver_number and lap_start_seconds is not None and lap_end_seconds is not None
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
        if seconds(lap_row.get("PitOutTime")) is not None or seconds(lap_row.get("PitInTime")) is not None:
            raise ValueError("pit-in and pit-out laps are not valid comparison laps")
        # Use the raw car stream for the trace. FastF1's convenience
        # get_telemetry() helper merges position and car channels, which can
        # introduce interpolated/padded samples around some laps.
        telemetry_data = lap_row.get_car_data().add_distance().copy()
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
        if incomplete_openf1 and incomplete_openf1[0]:
            return finish(incomplete_openf1[0], incomplete_openf1[1], "OpenF1")
        try:
            data = load_session(year, gp, session, round)
            driver_number = str(data.get_driver(driver).get("DriverNumber", driver))
            samples = openf1_lap_telemetry(year, gp, session, driver_number, lap)
            if samples:
                return finish(samples, project_corners_onto_lap(data, samples), "OpenF1")
        except Exception as openf1_error:
            logger.warning("OpenF1 telemetry fallback unavailable for %s L%s: %s", driver, lap, openf1_error)
            raise HTTPException(422, f"No telemetry source returned this lap. FastF1: {fastf1_error}; OpenF1: {openf1_error}") from openf1_error
        raise HTTPException(422, "No telemetry is published for this session/lap yet.")

    telemetry_data = telemetry_data.copy()
    telemetry_data["ElapsedSeconds"] = telemetry_data["Time"].dt.total_seconds()
    columns = ["Distance", "ElapsedSeconds", "Speed", "Throttle", "Brake", "RPM", "nGear", "DRS", "X", "Y"]
    # FastF1 car data is already a low-rate official timing stream. Keep every
    # published row; a second 4x downsample made braking traces visibly coarse.
    samples = telemetry_data[columns].replace({np.nan: None}).to_dict("records")
    if samples:
        return finish(samples, project_corners_onto_lap(data, samples), "FastF1")

    try:
        samples = openf1_lap_telemetry(year, gp, session, driver_number, lap)
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
        return RedirectResponse('https://apex-f1-data.eufrandota14.chatgpt.site/apex/')
    return FileResponse(ROOT / "index.html")


@app.get("/{asset_name}")
def frontend_asset(asset_name: str) -> FileResponse:
    """Serve only the browser bundle, never backend source or deployment files."""
    if os.environ.get('VERCEL'):
        raise HTTPException(404, 'Frontend assets are served by the site host.')
    allowed = {
        "alignment.js",
        "telemetry-model.js",
        "apple-ui.css",
        "app.js",
        "config.js",
        "design-system.css",
        "polish.css",
        "styles.css",
    }
    if asset_name not in allowed:
        raise HTTPException(404, "Not found")
    return FileResponse(ROOT / asset_name)
