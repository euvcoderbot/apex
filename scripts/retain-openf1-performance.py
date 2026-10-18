"""Package validated source feeds for exact completed sessions, not model scores."""
import gzip
import hashlib
import json
from pathlib import Path
import sys
from datetime import datetime

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server
from openf1_performance import adapt_performance

records = {}
for code in ('Q', 'R'):
    path = server.prepared_cache_path('openf1-performance-v1', 2026, 'Azerbaijan Grand Prix', code)
    if not path.exists():
        raise RuntimeError('Capture and validate the source feeds before retaining them')
    with gzip.open(path, 'rt', encoding='utf-8') as stream:
        bundle = json.load(stream)
    adapt_performance(2026, 'Azerbaijan Grand Prix', code, bundle)
    # Original capture controls expiry; running this packager cannot renew it.
    captured = datetime.fromisoformat(bundle['captured_at']).timestamp()
    source = json.dumps(bundle, sort_keys=True, separators=(',', ':')).encode()
    records[f'2026:Azerbaijan Grand Prix:{code}'] = {
        'bundle': bundle, 'sha256': hashlib.sha256(source).hexdigest(),
        'expires': captured + 30 * 86400}
with gzip.GzipFile(filename=str(ROOT / 'openf1-performance.json.gz'), mode='wb', mtime=0) as stream:
    stream.write(json.dumps(records, separators=(',', ':')).encode())
print('Retained two validated completed-session source bundles with original capture dates and checksums.')
