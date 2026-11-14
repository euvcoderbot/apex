"""Official circuit references from the FIA's per-event F1 circuit maps.

usage: fetch-fia-circuit-maps.py <year> [out.json] [--pdfs DIR]

Every F1 event page on fia.com carries the Race Director's circuit map (a PDF
read here with pdfplumber). Its text gives what F1 itself publishes about the
track: the official corner numbers, the circuit centreline length, the sector
lengths, the speed trap and intermediate positions ("250m before T13"), and the
zones where the cars run on straights:

- 2026: the Straight Mode zones (A1-A5), each with its activation point in
  normal grip and in low grip ("n/a" where a zone is not used), and the
  Overtake detection and activation points. The table sits under the map, one
  column per kind, so it is read by word position, not by text order.
- Before 2026: the DRS detection and activation points from the map's legend
  ("DRS Detection 1 [250m before Turn 5]"). Maps published only as images
  (several 2025 events) have no text and give nothing.

Points keep the text exactly as printed ('text') next to the parsed form
({'turn', 'offset_m'} with 'at' for entry / exit / apex, or {'line', 'offset_m'}
for the finish line). A point that cannot be read keeps only its text.
`zones` (normal-grip Straight Mode or DRS activation points that name a turn)
is what scripts/audit-circuit-segments.py checks our classification against;
scripts/build-track-profiles.mjs places all of them on the season's fastest lap.

--pdfs DIR keeps the downloaded PDFs there, so a second run reads them from disk.
"""
import io
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

try:
    import pdfplumber
except ImportError:  # the parsers below work on text and words; only main() needs the PDF reader
    pdfplumber = None

FIA = 'https://www.fia.com'
CHAMPIONSHIP = FIA + '/documents/championships/fia-formula-one-world-championship-14'
SEASONS = {2023: 'season-2023-2042', 2024: 'season-2024-2043', 2025: 'season-2025-2071', 2026: 'season-2026-2072'}
TURN = r'(?:T(?:SP)?|Turn)\s*(\d+[A-Z]?)'
POINT = re.compile(r'(\d+)\s*m\s+(after|before)\s+(?:apex\s+(?:of\s+)?)?' + TURN + r'|(Exit|Entry|Apex)(?:\s+(?:of|to))?\s+' + TURN, re.I)


def get(url, binary=False):
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (apex circuit references)'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
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


def read_point(text):
    """One printed position, parsed where its wording is unambiguous; always with the printed text."""
    printed = ' '.join(str(text or '').split()).strip(' -[]()')
    if not printed or printed.lower() in ('n/a', 'na'):
        return None
    out = {'text': printed}
    core = re.sub(r'\s*/\s*pit exit$', '', printed, flags=re.I)
    sign = lambda side: 1 if side.lower() == 'after' else -1
    if m := re.fullmatch(r'(\d+)\s*m\s+(after|before)\s+(?:the\s+)?(finish|control|start)\s+line', core, re.I):
        return {**out, 'line': m.group(3).lower(), 'offset_m': int(m.group(1)) * sign(m.group(2))}
    # "45m after T14-entry", "40m before T3 exit", "105m after apex T17"
    if m := re.fullmatch(r'(\d+)\s*m\s+(after|before)\s+(apex\s+(?:of\s+)?)?' + TURN + r'(?:[\s-]*(entry|exit))?', core, re.I):
        at = m.group(5) or ('apex' if m.group(3) else None)
        return {**out, 'turn': m.group(4).upper(), 'offset_m': int(m.group(1)) * sign(m.group(2)), **({'at': at.lower()} if at else {})}
    # "Exit T18", "Exit of T17", "At entry to turn 10", "Apex of Turn 2", "Mid-T15"
    if m := re.fullmatch(r'(?:at\s+)?(exit|entry|apex|mid)(?:\s+(?:of|to))?[\s-]+' + TURN, core, re.I):
        return {**out, 'turn': m.group(2).upper(), 'offset_m': 0, 'at': m.group(1).lower()}
    # "T15 Exit", "T14-exit"
    if m := re.fullmatch(TURN + r'[\s-]*(entry|exit|apex)', core, re.I):
        return {**out, 'turn': m.group(1).upper(), 'offset_m': 0, 'at': m.group(2).lower()}
    # "T11", "Turn 11", "On Turn 20"
    if m := re.fullmatch(r'(?:on\s+|at\s+)?' + TURN, core, re.I):
        return {**out, 'turn': m.group(1).upper(), 'offset_m': 0}
    return out   # e.g. "SC2 before Turn 2": kept as printed, not placed


def _runs(words, gap=6):
    """Words on one printed line, grouped into runs separated by gaps wider than `gap` points."""
    runs = []
    for w in sorted(words, key=lambda w: w['x0']):
        if runs and w['x0'] - runs[-1]['x1'] < gap:
            runs[-1]['x1'], runs[-1]['text'] = w['x1'], runs[-1]['text'] + ' ' + w['text']
        else:
            runs.append({'x0': w['x0'], 'x1': w['x1'], 'top': w['top'], 'text': w['text']})
    return runs


def table_2026(words):
    """The Overtake and Straight Mode columns of a 2026 map's table, by position.

    Each '- ZONE An -' sits in the middle of its row: the normal-grip activation
    ends just left of it, the low-grip one starts just right of it. The Overtake
    values sit right of their DETECTION / ACTIVATION labels; a value wrapped onto
    a neighbouring line goes with the nearer label.
    """
    heads = [w for w in words if w['text'] == 'OVERTAKE']
    if not heads:
        return {}
    head = max(heads, key=lambda w: w['top'])   # the table's heading, below the map's legend
    lines = {}
    for w in words:
        if head['top'] + 4 < w['top'] < head['top'] + 50:
            lines.setdefault(round(w['top']), []).append(w)
    runs = [r for top in sorted(lines) for r in _runs(lines[top])]
    labels = {}
    for r in runs:
        first = r['text'].split()[0]
        if first in ('DETECTION', 'ACTIVATION') and r['x0'] < head['x0']:
            labels[first] = r
    zones = [r for r in runs if re.fullmatch(r'-?\s*ZONE A\d+\s*-?', r['text'])]
    out = {}
    if labels:
        left = min(l['x0'] for l in labels.values())
        # The normal-grip values end next to the zone labels; with no zones the Straight Mode column starts at its heading.
        straight_head = next((w['x0'] for w in words if w['text'] == 'STRAIGHT' and abs(w['top'] - head['top']) < 3), head['x1'] + 100)
        right = min(z['x0'] for z in zones) - 25 if zones else straight_head - 2
        values = {k: [] for k in labels}
        for r in runs:
            if r in zones or r['x0'] < left or r['x1'] > right:
                continue
            text = re.sub(r'^(DETECTION|ACTIVATION)\s*', '', r['text'])
            if not text.strip(' -'):
                continue
            nearest = min(labels, key=lambda k: abs(labels[k]['top'] - r['top']))
            values[nearest].append((r['top'], r['x0'], text))
        overtake = {key.lower(): p for key, parts in values.items() if (p := read_point(' '.join(t for _, _, t in sorted(parts))))}
        if overtake:
            out['overtake'] = overtake
    if zones:
        straight = []
        for z in zones:
            near = [r for r in runs if r is not z and abs(r['top'] - z['top']) <= 8]
            pick = lambda rs: read_point(min(rs, key=lambda r: abs(r['top'] - z['top']))['text']) if rs else None
            normal = pick([r for r in near if 0 <= z['x0'] - r['x1'] < 15])
            low = pick([r for r in near if 0 <= r['x0'] - z['x1'] < 15])
            if normal or low:
                straight.append({'zone': re.search(r'A\d+', z['text']).group(0), 'normal': normal, 'low': low})
        out['straight_mode'] = straight
    return out


DRS_LEGEND = re.compile(r'DRS (Detection|Activation)\s*(\d?)(?!\d)\s*(?:\[([^\]]*)\]|\(([^)]*)\)|((?:\d+\s*m\s+)?[^\n\[(]*?'
                        + TURN + r'(?:[\s-]*(?:entry|exit))?))')


def drs_points(text):
    """DRS detection and activation points from a pre-2026 map's legend (mixed case; the labels on the map are capitals)."""
    out = {'detection': [], 'activation': []}
    for m in DRS_LEGEND.finditer(text):
        printed = next(g for g in (m.group(3), m.group(4), m.group(5)) if g is not None)
        if p := read_point(printed):
            entry = {'number': int(m.group(2)) if m.group(2) else None, **p}
            if entry not in out[m.group(1).lower()]:
                out[m.group(1).lower()].append(entry)
    return out


def parse_drs_era(text):
    out = {'zone_kind': 'drs', 'zones': []}
    if m := re.search(r'Centreline Length\s*=\s*([\d.]+)\s*km', text, re.I):
        out['centreline_m'] = round(float(m.group(1))*1000)
    drs = drs_points(text)
    if drs['detection'] or drs['activation']:
        out['drs'] = drs
        out['zones'] = [{k: p[k] for k in ('turn', 'offset_m', 'at') if k in p} for p in drs['activation'] if 'turn' in p]
    return out


def parse(text, words=None):
    """Circuit data from the map page's text (and, for 2026 maps, its words with positions)."""
    if re.search(r'Centreline Length\s*=', text, re.I):
        return parse_drs_era(text)
    out = {}
    if m := re.search(r'CENTRELINE LENGTH\s*-\s*([\d.]+)\s*km', text):
        out['centreline_m'] = round(float(m.group(1))*1000)
    lengths = [round(float(v)*1000) for v in re.findall(r'SECTOR\s*\d\s*-\s*([\d.]+)\s*km', text)]
    if len(lengths) != 3:   # some extractions print the three lengths under SECTOR 3, 2, 1
        lengths = [round(float(v)*1000) for v in re.findall(r'-\s*([\d.]+)\s*km', text)]
        if out.get('centreline_m') in lengths:
            lengths.remove(out['centreline_m'])
        lengths = list(reversed(lengths[:3])) if len(lengths) >= 3 else []
    if len(lengths) == 3 and abs(sum(lengths) - out.get('centreline_m', 0)) <= 10:
        out['sectors_m'] = lengths
    timing = text[text.find('SPEED TRAP'):] if 'SPEED TRAP' in text else ''
    if m := POINT.search(timing):
        out['speed_trap'] = point(m)
    zones = []
    table = table_2026(words) if words is not None else {}
    if table or (words is not None and 'STRAIGHT MODE' in text):
        out.update(table)
        out['zone_kind'] = 'straight-mode'
        out.setdefault('straight_mode', [])
        zones = [{k: z['normal'][k] for k in ('turn', 'offset_m', 'at') if k in z['normal']}
                 for z in out['straight_mode'] if z['normal'] and 'turn' in z['normal']]
    elif 'ACTIVATION' in text:
        zones = [point(m) for m in re.finditer(r'ACTIVATION\s*\d*\s*-\s*' + POINT.pattern, text, re.I) for m in [POINT.search(m.group(0))]]
        out['zone_kind'] = 'drs'
    out['zones'] = zones
    return out


def map_pdf(event_html):
    links = re.findall(r'href="(/system/files/decision-document/[^"]+\.pdf)"', event_html)
    maps = [l for l in links if 'circuit_map' in l and 'f2' not in l.lower() and 'f3' not in l.lower()]
    # The page lists the newest document first; a map on its own beats the bundle with pit-lane drawings.
    alone = [l for l in maps if 'pit_lane' not in l]
    return (alone or maps or [None])[0]


def read_map(data):
    """The map page (the one giving the centreline length) of an FIA maps PDF: its text and words."""
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for page in pdf.pages:
            page = page.dedupe_chars()   # some maps print bold labels twice, slightly offset ("ZZOONNEE AA11")
            text = page.extract_text() or ''
            if 'CENTRELINE' in text.upper():
                return text, page.extract_words()
    return '', None


def main():
    argv = sys.argv[1:]
    pdfs = None
    if '--pdfs' in argv:
        k = argv.index('--pdfs')
        pdfs = Path(argv[k + 1])
        argv = argv[:k] + argv[k + 2:]
        pdfs.mkdir(parents=True, exist_ok=True)
    if pdfplumber is None:
        sys.exit('This script needs pdfplumber: pip install pdfplumber')
    year = int(argv[0])
    target = Path(argv[1] if len(argv) > 1 else f'data/fia-circuit-maps/{year}.json')
    season = f'{CHAMPIONSHIP}/season/{SEASONS[year]}'
    events = sorted(set(re.findall(r'value="(/documents/championships/[^"]+/event/[^"]+)"', get(season))))
    circuits = []
    for path in events:
        name = urllib.parse.unquote(path.rsplit('/', 1)[1])
        pdf = map_pdf(get(FIA+path))
        if not pdf:
            print(f'{name:32} no circuit map published', flush=True)
            continue
        cached = pdfs / re.sub(r'[^A-Za-z0-9_.-]+', '_', urllib.parse.unquote(pdf.rsplit('/', 1)[1])) if pdfs else None
        if cached and cached.exists():
            data = cached.read_bytes()
        else:
            data = get(FIA+pdf, binary=True)
            if cached:
                cached.write_bytes(data)
        text, words = read_map(data)
        found = parse(text, words) if text else {'zones': [], 'image_only': True}
        if m := re.search(r'FORMULA 1 .*?(?:GRAND PRIX|GP)[^\n]*?-\s*([^\n]+)', text):
            found['venue'] = re.sub(r'\s*Circuit Map$', '', m.group(1)).strip()
        circuits.append({'event': name, 'source': FIA+pdf, **found})
        count = len(found.get('straight_mode') or (found.get('drs') or {}).get('activation') or [])
        print(f"{name:32} {found.get('centreline_m', '?'):>6} m  {count} {found.get('zone_kind', 'no')} zones"
              f"  overtake {'yes' if found.get('overtake') else 'no'}{'  image only' if not text else ''}", flush=True)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({'year': year, 'fetched': time.strftime('%Y-%m-%d'), 'circuits': circuits}, indent=1, ensure_ascii=False), encoding='utf-8')
    print(f'{len(circuits)} circuits -> {target}')


if __name__ == '__main__':
    main()
