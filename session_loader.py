"""Request-scoped, parallel fresh retrieval with the unchanged FastF1 parsers.

FastF1 3.8's normal Session.load fetches each feed sequentially and its parser
decorators consult disk before inspecting a supplied response. These adapters
only bypass that wrapper inside a fresh-load ContextVar. Other threads and
legacy telemetry requests retain their normal behavior. No responses survive
the request, and no global cache settings are toggled.
"""
from concurrent.futures import ThreadPoolExecutor
from contextvars import ContextVar, copy_context
from functools import wraps
from bisect import bisect_left
import json
import time

import fastf1
from fastf1 import _api
from fastf1.req import Cache
import requests

_active = ContextVar('apex_fresh_session', default=None)
_PAGES = {
    'session_info':'session_info', 'driver_info':'driver_list',
    'session_status_data':'session_status', 'track_status_data':'track_status',
    '_extended_timing_data':'timing_data', 'timing_app_data':'timing_app_data',
    'weather_data':'weather_data', 'lap_count':'lap_count',
    'car_data':'car_data', 'position_data':'position',
}
_PARSERS = {page: getattr(_api, name).__wrapped__ for name, page in _PAGES.items()}


def exact_event(year, gp):
    """Resolve a calendar event without FastF1's unsafe fuzzy fallback."""
    schedule = fastf1.get_event_schedule(
        year, include_testing=False, backend='fastf1'
    )
    wanted = str(gp).strip().casefold()
    matches = schedule[
        schedule['EventName'].astype(str).str.strip().str.casefold() == wanted
    ]
    if len(matches) != 1:
        raise ValueError(f"'{gp}' is not an exact event on the {year} calendar")
    return matches.iloc[0]


def fresh_get(url, **kwargs):
    # requests (not requests-cache), with a bounded upstream wait.
    kwargs.setdefault('timeout', (3.5, 10))
    started = time.perf_counter()
    response = requests.get(url, **kwargs)
    context = _active.get()
    if context is not None:
        context['network_seconds'].append(time.perf_counter()-started)
    return response


def _install_adapters():
    original_get = Cache.requests_get
    @wraps(original_get)
    def get(cls, url, **kwargs):
        return fresh_get(url, **kwargs) if _active.get() is not None else original_get(url, **kwargs)
    Cache.requests_get = classmethod(get)
    for name, page in _PAGES.items():
        original = getattr(_api, name)
        parser = original.__wrapped__
        def wrap(original, parser, page):
            @wraps(original)
            def routed(path, **kwargs):
                context = _active.get()
                if context is None or path != context.get('path'):
                    return original(path, **kwargs)
                return context['feeds'][page].result()
            return routed
        setattr(_api, name, wrap(original, parser, page))


_install_adapters()


def download_feed(path, page):
    suffix = path + _api.pages[page]
    response = fresh_get(_api.base_url + suffix, headers=_api.headers)
    if response.status_code >= 400:
        response = fresh_get(_api.base_url_mirror + suffix, headers=_api.headers)
    response.raise_for_status()
    records = []
    for line in response.content.decode('utf-8-sig').splitlines():
        if not line:
            continue
        try:
            records.append([line[:12], json.loads(line[12:])])
        except json.JSONDecodeError:
            continue  # same malformed-record handling as FastF1.fetch_page
    return records


def _download_stream(path, page):
    """Download one compressed jsonStream without FastF1's disk cache."""
    suffix = path + _api.pages[page]
    response = fresh_get(_api.base_url + suffix, headers=_api.headers)
    if response.status_code >= 400:
        response = fresh_get(_api.base_url_mirror + suffix, headers=_api.headers)
    response.raise_for_status()
    return response.content.decode('utf-8-sig').splitlines()


def _window_records(records, start, end):
    margin = .75
    for record in records:
        if len(record) < 13:
            continue
        try:
            stamp = _api.to_timedelta(record[:12]).total_seconds()
        except Exception:
            continue
        if start - margin <= stamp <= end + margin:
            yield record


def _selected_car_rows(records, driver_number, start, end):
    rows = []
    for record in _window_records(records, start, end):
        try:
            message = _api.parse(record[12:], zipped=True)
        except Exception:
            continue
        for entry in message.get('Entries', ()):
            channels = entry.get('Cars', {}).get(driver_number, {}).get('Channels')
            if not channels:
                continue
            try:
                date = _api.to_datetime(entry['Utc']).timestamp()
                rows.append({
                    'date': date,
                    'Speed': int(channels.get('2', 0)),
                    'RPM': int(channels.get('0', 0)),
                    'nGear': int(channels.get('3', 0)),
                    'Throttle': int(channels.get('4', 0)),
                    'Brake': bool(int(channels.get('5', 0))),
                    'DRS': int(channels.get('45', 0)),
                })
            except (TypeError, ValueError, KeyError):
                continue
    rows.sort(key=lambda row: row['date'])
    return rows


def _selected_position_rows(records, driver_number, start, end):
    rows = []
    for record in _window_records(records, start, end):
        try:
            message = _api.parse(record[12:], zipped=True)
        except Exception:
            continue
        for sample in message.get('Position', ()):
            entry = sample.get('Entries', {}).get(driver_number)
            if not entry:
                continue
            try:
                rows.append((_api.to_datetime(sample['Timestamp']).timestamp(),
                             int(entry['X']), int(entry['Y'])))
            except (TypeError, ValueError, KeyError):
                continue
    rows.sort(key=lambda row: row[0])
    return rows


def _lap_samples(car_rows, position_rows, lap_start, lap_end):
    if not car_rows:
        raise ValueError('selected lap car stream was empty')
    origin = car_rows[0]['date']
    duration = max(0.0, lap_end - lap_start)
    car_rows = [row for row in car_rows if -.25 <= row['date'] - origin <= duration + .35]
    position_dates = [row[0] for row in position_rows]
    distance = 0.0
    previous = None
    samples = []
    for row in car_rows:
        elapsed = row['date'] - origin
        if previous is not None:
            dt = max(0.0, row['date'] - previous['date'])
            distance += ((previous['Speed'] + row['Speed']) / 2 / 3.6) * dt
        previous = row
        x = y = None
        if position_dates:
            index = bisect_left(position_dates, row['date'])
            candidates = [i for i in (index - 1, index) if 0 <= i < len(position_dates)]
            if candidates:
                nearest = min(candidates, key=lambda i: abs(position_dates[i] - row['date']))
                if abs(position_dates[nearest] - row['date']) <= .3:
                    _, x, y = position_rows[nearest]
        samples.append({
            'Distance': distance, 'ElapsedSeconds': elapsed, 'Speed': row['Speed'],
            'Throttle': row['Throttle'], 'Brake': row['Brake'], 'RPM': row['RPM'],
            'nGear': row['nGear'], 'DRS': row['DRS'], 'X': x, 'Y': y,
        })
    return samples


def load_selected_lap_telemetry(year, gp, session_name, driver_number,
                                lap_start, lap_end):
    """Retrieve and decode only one driver's selected lap.

    The official archives are session-wide, but decoding every driver into
    pandas frames dominates historical trace latency. This path downloads the
    two source streams concurrently and parses only the requested driver and
    lap window. Nothing is retained between requests.
    """
    event = exact_event(year, gp)
    data = event.get_session(session_name)
    path = data.api_path
    with ThreadPoolExecutor(max_workers=2, thread_name_prefix='selected-lap') as pool:
        car_future = pool.submit(_download_stream, path, 'car_data')
        position_future = pool.submit(_download_stream, path, 'position')
        car_rows = _selected_car_rows(car_future.result(), str(driver_number), lap_start, lap_end)
        position_rows = _selected_position_rows(position_future.result(), str(driver_number), lap_start, lap_end)
    return _lap_samples(car_rows, position_rows, lap_start, lap_end)


def load_selected_laps_telemetry(year, gp, session_name, selections):
    """Download a session archive once and extract one selected lap per team."""
    event = exact_event(year, gp)
    data = event.get_session(session_name)
    path = data.api_path
    with ThreadPoolExecutor(max_workers=2, thread_name_prefix='selected-laps') as pool:
        car_future = pool.submit(_download_stream, path, 'car_data')
        position_future = pool.submit(_download_stream, path, 'position')
        car_records, position_records = car_future.result(), position_future.result()

    def extract(selection):
        number = str(selection['driver_number'])
        start, end = float(selection['start']), float(selection['end'])
        try:
            car_rows = _selected_car_rows(car_records, number, start, end)
            position_rows = _selected_position_rows(position_records, number, start, end)
            return selection['team'], _lap_samples(car_rows, position_rows, start, end), None
        except Exception as exc:
            return selection['team'], None, str(exc)

    # Parsing is independent and bounded to the ten team representatives.
    with ThreadPoolExecutor(max_workers=4, thread_name_prefix='lap-extract') as pool:
        return [future.result() for future in (pool.submit(extract, item) for item in selections)]


def load_fresh_session(year, gp, session_name, telemetry=False):
    started = time.perf_counter()
    context = {'path':None, 'feeds':{}, 'network_seconds':[]}
    token = _active.set(context)
    try:
        event = exact_event(year, gp)
        data = event.get_session(session_name)
        context['path'] = data.api_path
        schedule_end = time.perf_counter()
        pages = set(_PAGES.values())
        if not telemetry:
            pages -= {'car_data', 'position'}
        if data.name not in data._RACE_LIKE_SESSIONS:
            pages.remove('lap_count')
        with ThreadPoolExecutor(max_workers=8, thread_name_prefix='fresh-session') as pool:
            def submit(function, *args, **kwargs):
                return pool.submit(copy_context().run, function, *args, **kwargs)
            def retrieve_and_parse(page):
                # FastF1 decodes the compressed telemetry archives; keep its
                # parser, but overlap both downloads with the timing feeds.
                records = (_api.fetch_page(data.api_path, page) if page in {'car_data','position'}
                           else download_feed(data.api_path, page))
                return _PARSERS[page](data.api_path, response=records)
            # Parse each feed as soon as it arrives, while the remaining network
            # requests are still running. Session.load keeps its normal order.
            context['feeds'] = {page:submit(retrieve_and_parse,page)
                                for page in sorted(pages,key=lambda p: p not in {'car_data','position'})}
            # Classification is independent of the timing feeds; overlap its
            # network request without changing FastF1's merge/penalty handling.
            original_results = data._drivers_results_from_ergast
            results = submit(original_results, load_drivers=True, load_results=True)
            data._drivers_results_from_ergast = lambda **kwargs: results.result()
            original_laps = data._ergast.get_lap_times
            if data.name == 'Race':
                first_lap = submit(original_laps, event.year, event.RoundNumber, lap_number=1)
                data._ergast.get_lap_times = lambda *args, **kwargs: first_lap.result()
            try:
                data.load(laps=True, telemetry=telemetry, weather=True, messages=False)
            finally:
                data._drivers_results_from_ergast = original_results
                data._ergast.get_lap_times = original_laps
        data.apex_load_timings = {
            'resolve_ms': (schedule_end-started)*1000,
            'load_ms': (time.perf_counter()-schedule_end)*1000,
            'upstream_requests':len(context['network_seconds']),
        }
        return data
    finally:
        _active.reset(token)
