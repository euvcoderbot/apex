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


def load_fresh_session(year, gp, session_name, telemetry=False):
    started = time.perf_counter()
    context = {'path':None, 'feeds':{}, 'network_seconds':[]}
    token = _active.set(context)
    try:
        event = fastf1.get_event(year, gp, backend='fastf1', exact_match=True)
        if event is None:
            raise ValueError(f'Unknown event: {gp}')
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
