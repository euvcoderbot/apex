import asyncio
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi import HTTPException
from api_security import limited_json,local_request_allowed

class Body:
    def __init__(self,body,headers=None,delay=0):self.body=body;self.headers=headers or {};self.delay=delay
    async def stream(self):
        await asyncio.sleep(self.delay)
        yield self.body

class RequestBudgets(unittest.TestCase):
    def test_nesting_nonfinite_and_compression(self):
        for request,status in [(Body(b'['*65+b'0'+b']'*65),400),(Body(b'{"x":NaN}'),400),(Body(b'{"x":1e999}'),400),(Body(b'x',{'content-encoding':'gzip'}),415)]:
            with self.assertRaises(HTTPException) as caught:asyncio.run(limited_json(request,1000))
            self.assertEqual(caught.exception.status_code,status)
        self.assertEqual(asyncio.run(limited_json(Body(b'"'+b'['*80+b'"'),1000)),'['*80)

    def test_slow_body_has_a_deadline(self):
        with self.assertRaises(HTTPException) as caught:asyncio.run(limited_json(Body(b'{}',delay=.1),1000,read_timeout=.01))
        self.assertEqual(caught.exception.status_code,408)

    def test_local_host_and_cross_site_requests_fail_before_compute(self):
        def request(host='127.0.0.1',**headers):return SimpleNamespace(url=SimpleNamespace(hostname=host),headers=headers)
        self.assertTrue(local_request_allowed(request(),[]))
        self.assertFalse(local_request_allowed(request('evil.example'),[]))
        self.assertFalse(local_request_allowed(request(**{'sec-fetch-site':'cross-site'}),[]))
        self.assertFalse(local_request_allowed(request(origin='https://evil.example'),[]))
        self.assertTrue(local_request_allowed(request(origin='https://apex.example',**{'sec-fetch-site':'cross-site'}),['https://apex.example']))

if __name__=='__main__':unittest.main()
