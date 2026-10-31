"""The Python API is read from the published site and from this machine only, and never serves source."""
import asyncio
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import HTTPException
import server


class FakeRequest:
    def __init__(self, payload, length=None):
        self._payload, self.headers = payload, ({'content-length': str(length)} if length is not None else {})

    async def json(self):
        return self._payload

    async def stream(self):
        yield json.dumps(self._payload).encode()


def development(payload, length=None):
    return asyncio.run(server.car_development_progression(FakeRequest(payload, length), server.Response()))


class CorsTests(unittest.TestCase):
    def options(self):
        return next(m.kwargs for m in server.app.user_middleware if m.cls.__name__ == 'CORSMiddleware')

    def test_only_the_published_site_and_local_dashboards_may_read_it(self):
        options = self.options()
        self.assertNotIn('*', options['allow_origins'])
        self.assertIn('https://f1apexdata.eufrandota14.chatgpt.site', options['allow_origins'])
        import re
        regex = re.compile(options['allow_origin_regex'])
        for origin in ('http://127.0.0.1:54123', 'http://localhost:8000'):
            self.assertTrue(regex.fullmatch(origin), origin)
        for origin in ('https://evil.example', 'http://127.0.0.1.evil.example', 'https://127.0.0.1:54123'):
            self.assertFalse(regex.fullmatch(origin), origin)


class AssetTests(unittest.TestCase):
    def test_only_browser_scripts_and_styles_are_served(self):
        for name in ('server.py', 'package.json', 'vite.config.ts', '.env', 'requirements.txt', 'nope.js', '..%2Fserver.py'):
            with self.assertRaises(HTTPException) as caught:
                server.frontend_asset(name)
            self.assertEqual(caught.exception.status_code, 404, name)
        self.assertEqual(Path(server.frontend_asset('session-state.js').path).name, 'session-state.js')


class DevelopmentEndpointTests(unittest.TestCase):
    def rejected(self, payload, status=422, length=None):
        with self.assertRaises(HTTPException) as caught:
            development(payload, length)
        self.assertEqual(caught.exception.status_code, status)

    def test_oversized_or_malformed_requests_are_refused(self):
        self.rejected({'teams': [{'team': 'X', 'rounds': []}] * 31})
        self.rejected({'teams': [{'team': 'X', 'rounds': [{}] * 61}]})
        self.rejected({'teams': 'nope'})
        self.rejected(['not', 'an', 'object'])
        self.rejected({'teams': [{'team': 5, 'rounds': []}]})
        self.rejected({'teams': [{'team': 'X', 'rounds': ['no']}]})
        self.rejected({'teams': []}, status=413, length=2_000_000)

    def test_failures_do_not_echo_internal_errors(self):
        def boom(rounds):
            raise RuntimeError('secret path C:\internal')
        import performance
        original, performance.compute_development_progression = performance.compute_development_progression, boom
        try:
            with self.assertRaises(HTTPException) as caught:
                development({'teams': [{'team': 'X', 'rounds': []}]})
        finally:
            performance.compute_development_progression = original
        self.assertEqual(caught.exception.status_code, 422)
        self.assertNotIn('secret', caught.exception.detail)

    def test_body_limit_is_enforced_without_content_length(self):
        self.rejected({'teams': [], 'padding': 'x' * 1_000_001}, status=413)

    def test_allowed_post_preflight_and_rejected_foreign_origin(self):
        from starlette.middleware.cors import CORSMiddleware
        from starlette.datastructures import Headers
        options=next(m.kwargs for m in server.app.user_middleware if m.cls.__name__=='CORSMiddleware')
        middleware=CORSMiddleware(server.app, **options)
        def preflight(origin):
            return middleware.preflight_response(Headers({'origin':origin,'access-control-request-method':'POST','access-control-request-headers':'content-type'}))
        self.assertEqual(preflight('https://f1apexdata.eufrandota14.chatgpt.site').status_code,200)
        self.assertEqual(preflight('https://evil.example').status_code,400)

    def test_global_error_has_an_opaque_request_id(self):
        from types import SimpleNamespace
        response=asyncio.run(server.unexpected_error(SimpleNamespace(url=SimpleNamespace(path='/api/test')),RuntimeError('SECRET')))
        payload=json.loads(response.body)
        self.assertEqual(payload['detail'],'Internal server error')
        self.assertEqual(payload['request_id'],response.headers['X-Request-ID'])
        self.assertNotIn('SECRET',response.body.decode())

    def test_a_valid_request_still_works(self):
        self.assertEqual(development({'teams': []}), {'results': {}})


if __name__ == '__main__':
    unittest.main()
