"""Reliability for the seasons before 2022: save the power-unit usage snapshot the Reliability page reads.

The API serves /api/season/power-units from 2022 (server.py), the years scripts/snapshot-season.mjs saves. The FIA's
documents site goes back to 2019 and fia_documents reads those older "PU elements used per driver" documents the same
way (they list fewer elements: no exhaust before 2021). This calls the endpoint's own function directly for the given
seasons, so the payload is exactly what the API would return, and saves it like snapshot-season.mjs does:
assets/data/season/<hash>.json.gz plus the index entry for /api/season/power-units?year=<year>. server.py itself is not
changed, so no data revision moves.

Usage: .venv/Scripts/python.exe scripts/snapshot-power-units-history.py [2019 2020 2021]
"""
import gzip
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fastapi import Response  # noqa: E402

import server  # noqa: E402

OUT = ROOT / 'assets' / 'data' / 'season'


def main(years):
    index_path = OUT / 'index.json'
    index = json.loads(index_path.read_text(encoding='utf-8'))
    for year in years:
        try:
            data = server.season_power_units(Response(), year)
        except Exception as exc:   # e.g. the FIA site rate-limiting (429): the other seasons still save; run again later
            print(f'{year}: not saved ({getattr(exc, "detail", exc)})')
            continue
        if not data.get('rows'):
            print(f'{year}: no power-unit rows, nothing saved')
            continue
        body = gzip.compress(json.dumps(data, separators=(',', ':')).encode('utf-8'), compresslevel=9, mtime=0)
        name = hashlib.sha256(body).hexdigest()[:24] + '.json.gz'
        (OUT / name).write_bytes(body)
        index['entries'][f'/api/season/power-units?year={year}'] = {
            'file': name, 'saved_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'), 'settled': True}
        matched = sum(1 for r in data['rows'] if r.get('driver'))
        print(f'{year}: {len(data["rows"])} drivers ({matched} matched to the season), {len(data.get("history") or [])} events, '
              f'elements {", ".join(data.get("elements") or [])} -> {name}')
    index['generated'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    index_path.write_text(json.dumps(index, separators=(',', ':')), encoding='utf-8')


if __name__ == '__main__':
    main([int(y) for y in sys.argv[1:]] or [2019, 2020, 2021])
