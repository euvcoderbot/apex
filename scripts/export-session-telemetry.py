"""Export settled qualifying laps from the downloaded OpenF1 mirror.

No network calls, new clocks or alternative telemetry maths: reuses the API's
native lap-boundary interpolation, position join and speed integration.
One compressed pack per driver keeps every captured timed lap selectable.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--year', type=int, default=2026)
    parser.add_argument('--cache-root', action='append', type=Path, required=True)
    parser.add_argument('--gp')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    # This is an offline build operation. Missing mirror files are misses,
    # never an invitation to download a new season during a site build.
    def offline(*_args, **_kwargs):
        raise RuntimeError('Offline export: source stream not mirrored')
    server._openf1_fetch = offline
    manifest = json.loads((ROOT/'assets/data/prerendered/index.json').read_text())
    out = ROOT/'assets/data/telemetry'
    if not args.dry_run:
        out.mkdir(parents=True, exist_ok=True)
    target = out/'index.json'
    index = json.loads(target.read_text()) if target.exists() else {}
    if index.get('sourceRevision') != manifest['sourceRevision']:
        index = {'schema': 'native-lap-packs-v1', 'sourceRevision': manifest['sourceRevision'], 'entries': {}}
    seen, missing, laps, packs, size = set(), [], 0, 0, 0
    for query, filename in manifest['entries'].items():
        from urllib.parse import urlparse, parse_qs
        params = parse_qs(urlparse(query).query)
        if not query.startswith('/api/session?') or int(params.get('year', ['0'])[0]) != args.year:
            continue
        gp = params['gp'][0]
        if args.gp and gp != args.gp:
            continue
        session = params['session'][0]
        session = {'Q':'Qualifying', 'SQ':'Sprint Qualifying'}.get(session, session)
        if session not in ('Qualifying', 'Sprint Qualifying', 'Sprint Shootout') or (gp,session) in seen:
            continue
        seen.add((gp,session))
        data = json.loads(gzip.decompress((ROOT/'assets/data/prerendered'/filename).read_bytes()))
        key = data.get('openf1_session_key')
        if not key:
            continue
        session_count = 0
        for driver in data['drivers']:
            number = str(driver['number'])
            streams = None
            timings = {}
            for cache_root in args.cache_root:
                server.PREPARED_CACHE = cache_root
                server.openf1_session_stream.cache_clear()
                car = server.openf1_session_stream('car_data', key, number)
                location = server.openf1_session_stream('location', key, number)
                if car and location:
                    streams = {'car_data':car[1], 'location':location[1]}
                    lap_file = server.openf1_cache_path(server.openf1_url('laps', session_key=key, driver_number=number))
                    if lap_file.exists():
                        timings = {item['lap_number']:item for item in json.loads(gzip.decompress(lap_file.read_bytes()))}
                    break
            if not streams:
                missing.append(f'{gp} / {session} / {driver["code"]}: no mirrored streams')
                continue
            eligible = [lap for lap in driver['laps'] if not lap.get('out_lap')
                        and isinstance(lap.get('time'), (int,float)) and 20 < lap['time'] < 300]
            if args.dry_run:
                session_count += len(eligible)
                continue
            records = {}
            for lap in eligible:
                native = timings.get(lap['lap'], {})
                start = lap.get('date_start')
                if not start:
                    duration = native.get('lap_duration')
                    if not isinstance(duration,(int,float)) or abs(duration-lap['time']) > .005:
                        missing.append(f'{gp} / {session} / {driver["code"]} L{lap["lap"]}: native lap identity mismatch')
                        continue
                    start = native.get('date_start')
                if not start:
                    continue
                next_lap = next((item for item in driver['laps'] if item['lap'] == lap['lap']+1), {})
                next_start = next_lap.get('date_start') or timings.get(lap['lap']+1,{}).get('date_start')
                samples = server._openf1_lap_telemetry.__wrapped__(args.year, gp, session, number,
                    lap['lap'], 0, key, start, lap['time'], next_start, streams)
                if not samples:
                    missing.append(f'{gp} / {session} / {driver["code"]} L{lap["lap"]}: unsupported timing boundary')
                    continue
                coverage, complete = server.position_geometry_quality(samples)
                records[str(lap['lap'])] = {'driver':driver['code'], 'lap':lap['lap'], 'samples':samples,
                    'corners':[], 'source':'OpenF1 mirrored native lap', 'position_coverage':coverage,
                    'position_usable':coverage >= .55, 'position_complete':complete}
            if not records:
                continue
            identity = f'{args.year}:{gp}:{session}:{driver["code"]}'
            packed = gzip.compress(json.dumps({'sessionKey':key, 'laps':records}, separators=(',',':'), allow_nan=False).encode(), mtime=0)
            name = hashlib.sha256(identity.encode()).hexdigest()[:24]+'.json.gz'
            (out/name).write_bytes(packed)
            index['entries'][identity] = name
            packs += 1
            size += len(packed)
            session_count += len(records)
        laps += session_count
        print(f'{gp} / {session}: {session_count} laps', flush=True)
    if not args.dry_run:
        target.write_text(json.dumps(index, separators=(',',':')))
    print(json.dumps({'laps':laps,'packs':packs,'megabytes':round(size/1e6,2),'missingCount':len(missing),'missing':missing[:20]}), flush=True)


if __name__ == '__main__':
    main()
