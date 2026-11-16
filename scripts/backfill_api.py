"""Local compute for the old-season backfill (scripts/backfill-seasons.sh).

The same app as local_api, with one difference while it runs: when session_loader's direct download of a timing feed
fails (the official archive refuses an unauthenticated request for older seasons, and FastF1's mirror has none of 2018-2020
or a few 2023 races), the feed is read through FastF1's own fetch_page instead, which uses the F1 account signed in to
FastF1 and returns the same records. A feed FastF1 treats as optional (weather) that is missing everywhere is read as
empty, as FastF1's own loader does. No source file changes, so the data revisions (SOURCE, BACKEND) stay the same.

Started by: APEX_LOCAL_APP=scripts.backfill_api:app npm run local
"""
import requests

import session_loader

OPTIONAL_FEEDS = {'weather_data'}
_download_feed = session_loader.download_feed


def download_feed(path, page):
    try:
        return _download_feed(path, page)
    except requests.HTTPError:
        # Outside session_loader's load context, so FastF1's own (signed-in, cached) request runs, not the fast path's.
        token = session_loader._active.set(None)
        try:
            return _fetch_page(path, page) or []
        except Exception:
            if page in OPTIONAL_FEEDS:
                return []
            raise
        finally:
            session_loader._active.reset(token)


session_loader.download_feed = download_feed

# Telemetry (car data, positions) goes through FastF1's fetch_page inside the load context, where its request is the fast
# path's unauthenticated one: when that yields nothing, read it again outside the context (FastF1's signed-in request).
_fetch_page = session_loader._api.fetch_page


def fetch_page(path, name):
    try:
        records = _fetch_page(path, name)
    except Exception:
        records = None
        if session_loader._active.get() is None:
            raise
    if records or session_loader._active.get() is None:
        return records
    token = session_loader._active.set(None)
    try:
        return _fetch_page(path, name)
    finally:
        session_loader._active.reset(token)


session_loader._api.fetch_page = fetch_page

from local_api import app  # noqa: E402  (after the patch, so every session load uses it)

__all__ = ['app']
