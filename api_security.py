"""Bounded request decoding shared by compute endpoints."""
import json
import asyncio
import math
import re
from fastapi import HTTPException


async def limited_json(request, maximum, *, read_timeout=15):
    if request.headers.get('content-encoding','identity').lower() not in ('identity',''):
        raise HTTPException(415,'Compressed request bodies are not supported')
    try:
        declared = int(request.headers.get('content-length', '0'))
    except ValueError:
        raise HTTPException(400, 'Invalid Content-Length')
    if declared < 0:
        raise HTTPException(400, 'Invalid Content-Length')
    if declared > maximum:
        raise HTTPException(413, 'Request too large')
    body = bytearray()
    try:
        async with asyncio.timeout(read_timeout):
            async for chunk in request.stream():
                if len(body) + len(chunk) > maximum:
                    raise HTTPException(413, 'Request too large')
                body.extend(chunk)
    except TimeoutError:
        raise HTTPException(408,'Request body timed out')
    try:
        text=body.decode('utf-8-sig')
        depth=0;quoted=False;escaped=False
        for char in text:
            if quoted:
                if escaped:escaped=False
                elif char=='\\':escaped=True
                elif char=='"':quoted=False
            elif char=='"':quoted=True
            elif char in '[{':
                depth+=1
                if depth>64:raise ValueError('JSON nesting exceeds 64 levels')
            elif char in ']}':depth-=1
        def reject_constant(value):raise ValueError('Non-finite JSON number')
        def finite_float(value):
            result=float(value)
            if not math.isfinite(result):raise ValueError('Non-finite JSON number')
            return result
        return json.loads(text,parse_constant=reject_constant,parse_float=finite_float)
    except (ValueError, UnicodeDecodeError, RecursionError):
        raise HTTPException(400, 'Invalid JSON')


def local_request_allowed(request,allowed_origins):
    """Host/Fetch Metadata guard, not authentication. CLI requests stay usable."""
    if request.url.hostname not in ('127.0.0.1','localhost','::1'):return False
    origin=request.headers.get('origin')
    trusted=bool(origin and (origin in allowed_origins or re.fullmatch(r'http://(?:127\.0\.0\.1|localhost)(?::\d+)?',origin)))
    if origin and not trusted:return False
    return request.headers.get('sec-fetch-site')!='cross-site' or trusted
