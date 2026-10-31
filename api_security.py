"""Bounded request decoding shared by compute endpoints."""
import json
from fastapi import HTTPException


async def limited_json(request, maximum):
    try:
        declared = int(request.headers.get('content-length', '0'))
    except ValueError:
        raise HTTPException(400, 'Invalid Content-Length')
    if declared < 0:
        raise HTTPException(400, 'Invalid Content-Length')
    if declared > maximum:
        raise HTTPException(413, 'Request too large')
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > maximum:
            raise HTTPException(413, 'Request too large')
        body.extend(chunk)
    try:
        return json.loads(body)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(400, 'Invalid JSON')
