"""Official circuit references from the FIA's per-event F1 circuit maps.

usage: fetch-fia-circuit-maps.py <year> [out.json]     (needs: pip install pypdf)

Every F1 event page on fia.com carries the Race Director's circuit map. Its
text gives what F1 itself publishes about the track: the official corner
numbers, the circuit centreline length, the sector lengths, the speed trap and
intermediate positions ("250m before T13"), and the zones where the cars run
on straights: Straight Mode activation points in 2026 ("100m after T14"), DRS
activation points before that. scripts/audit-circuit-segments.py uses these as
the reference its classification is checked against.
"""
import io, json, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

try:
    import pypdf
except ImportError:
    sys.exit('This script needs pypdf: pip install pypdf')

FIA = 'https://www.fia.com'
SEASONS = {2023: 'season-2023-2042', 2024: 'season-2024-2043', 2025: 'season-2025-2071', 2026: 'season-2026-2072'}
POINT = re.compile(r'(\d+)\s*m\s+(after|before)\s+T(?:SP)?\s*(\d+[A-Z]?)|(Exit|Entry|Apex)\s+T(\d+[A-Z]?)', re.I)


def get(url, binary=False):
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (apex circuit references)'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                body = response.read()
                time.sleep(.5)
                return body if binary else body.decode('utf-8', 'replace')
        except Exception:
            if attempt == 3:
                raise
            time.sleep(3*(attempt+1))


def point(match):
    metres, side, turn, place, named = match.groups()
    if place:  # "Exit T18": at the corner's exit (or entry / apex)
        return {'turn': named.upper(), 'offset_m': 0, 'at': place.lower()}
    return {'turn': turn.upper(), 'offset_m': int(metres) if side.lower() == 'after' else -int(metres)}


def straight_mode_zones(page):
    """Normal-grip activation per Straight Mode zone, read row by row.

    Each "- ZONE An -" label sits at the right of its table row. On that row,
    Overtake and timing values are printed after a "-"; the zone's own values
    are not: the first is normal-grip activation, the second low grip.
    """
    chunks = []
    def visit(text, cm, tm, font, size):
        if text.strip():
            chunks.append((tm[4]*cm[0]+cm[4], tm[5]*cm[3]+cm[5], text))
    page.extract_text(visitor_text=visit)
    zones = {}
    for x, y, text in chunks:
        if m := re.search(r'ZONE\s+A(\d+)', text):
            row = ' '.join(t for cx, cy, t in sorted(chunks) if abs(cy-y) <= 3 and cx < x and 'ZONE' not in t)
            values = []
            for token in re.finditer(POINT.pattern + r'|n/a', row, re.I):
                if row[:token.start()].rstrip().endswith('-'):
                    continue  # an Overtake or timing value
                values.append(None if token.group(0).lower() == 'n/a' else point(POINT.match(token.group(0))))
            zones[int(m.group(1))] = values[0] if values else None
    # Zones listed as n/a are not used at this event.
    return [zones[k] for k in sorted(zones) if zones[k]]


def parse_drs_era(text):
    """2025-style maps: only the centreline length is read. Their timing and
    DRS points are printed without labels next to them, and pairing them with
    the legend by order is wrong on some maps (Monaco), so they are left out."""
    out = {'zone_kind': 'drs', 'zones': []}
    if m := re.search(r'Centreline Length\s*=\s*([\d.]+)\s*km', text, re.I):
        out['centreline_m'] = round(float(m.group(1))*1000)
    return out


def parse(text, page=None):
    """Circuit data from the map page's text (pypdf keeps label order)."""
    if 'Centreline Length =' in text or re.search(r'Centreline Length\s*=', text, re.I):
        return parse_drs_era(text)
    out = {}
    if m := re.search(r'CENTRELINE LENGTH\s*-\s*([\d.]+)\s*km', text):
        out['centreline_m'] = round(float(m.group(1))*1000)
    lengths = [round(float(v)*1000) for v in re.findall(r'-\s*([\d.]+)\s*km', text)]
    if 'centreline_m' in out and out['centreline_m'] in lengths:
        lengths.remove(out['centreline_m'])
    # Sector lengths are printed under SECTOR 3, 2, 1; they must add up to the lap.
    if len(lengths) >= 3 and abs(sum(lengths[:3])-out.get('centreline_m', 0)) <= 10:
        out['sectors_m'] = list(reversed(lengths[:3]))
    timing = text[text.find('SPEED TRAP'):] if 'SPEED TRAP' in text else ''
    found = POINT.findall(timing)
    if found:
        out['speed_trap'] = point(POINT.search(timing))
    # Straight Mode (2026) or DRS (earlier) activation points, normal grip.
    zones = []
    if re.search(r'ZONE\s+A\d', text) and page is not None:
        zones = straight_mode_zones(page)
        out['zone_kind'] = 'straight-mode'
    elif 'ACTIVATION' in text:
        zones = [point(m) for m in re.finditer(r'ACTIVATION\s*\d*\s*-\s*' + POINT.pattern, text, re.I) for m in [POINT.search(m.group(0))]]
        out['zone_kind'] = 'drs'
    out['zones'] = zones
    return out


def map_pdf(event_html):
    links = re.findall(r'href="(/system/files/decision-document/[^"]+\.pdf)"', event_html)
    maps = [l for l in links if 'circuit_map' in l and 'f2' not in l.lower() and 'f3' not in l.lower()]
    # The page lists the newest document first; a map on its own beats the
    # bundle with pit-lane drawings.
    alone = [l for l in maps if 'pit_lane' not in l]
    return (alone or maps or [None])[0]


def main():
    year = int(sys.argv[1])
    target = Path(sys.argv[2] if len(sys.argv) > 2 else f'data/fia-circuit-maps/{year}.json')
    season = f'{FIA}/documents/championships/fia-formula-one-world-championship-14/season/{SEASONS[year]}'
    events = sorted(set(re.findall(r'value="(/documents/championships/[^"]+/event/[^"]+)"', get(season))))
    circuits = []
    for path in events:
        name = urllib.parse.unquote(path.rsplit('/', 1)[1])
        pdf = map_pdf(get(FIA+path))
        if not pdf:
            print(f'{name:32} no circuit map published', flush=True)
            continue
        reader = pypdf.PdfReader(io.BytesIO(get(FIA+pdf, binary=True)))
        found = next((p for p in reader.pages if 'CENTRELINE' in (p.extract_text() or '').upper()), None)
        page = found.extract_text() if found else ''
        data = parse(page, found)
        if m := re.search(r'FORMULA 1 .*?(?:GRAND PRIX|GP)[^\n]*?-\s*([^\n]+)', page):
            data['venue'] = m.group(1).strip()
        circuits.append({'event': name, 'source': FIA+pdf, **data})
        print(f"{name:32} {data.get('centreline_m', '?'):>6} m  {len(data.get('zones', []))} {data.get('zone_kind', '')} zones"
              f"  speed trap {data.get('speed_trap')}", flush=True)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({'year': year, 'fetched': time.strftime('%Y-%m-%d'), 'circuits': circuits}, indent=1, ensure_ascii=False), encoding='utf-8')
    print(f'{len(circuits)} circuits -> {target}')


if __name__ == '__main__':
    main()
