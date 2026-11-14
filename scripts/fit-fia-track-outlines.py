"""The FIA's own track drawing, fitted to our lap: the Tracks map then shows the circuit exactly as the FIA draws it.

For each track in assets/data/track-profiles.json, the Race Director's circuit map PDF (its URL in
data/fia-circuit-maps/<year>.json) is read with pdfplumber. The track is the grey band the FIA fills along the circuit: of
the page's filled vector shapes, the grey colour whose shapes span the largest area. Its outline is sampled every 0.75 pt.

Our lap (the fastest qualifying lap's GPS outline, map.outline) is fitted onto that band with a similarity transform
(rotation, uniform scale, translation, no mirroring): a coarse search over the rotation, then iterative closest point.
Every lap point is then snapped to the middle of the band (the mean of the band's points around it), so the drawn line
is the FIA's line, in the FIA's orientation, while each point keeps its place on the lap: speeds, sectors, corners and
zones (placed by lap distance) stay exactly where they were.

Writes map.fia = {outline: [[x, -y], ...] (page points, y negated as the GPS outline is), corners: [...], fit: {...}}
into assets/data/track-profiles.json. A fit whose median distance to the band is over 3 pt (the band is about 4-6 pt
wide) is left out, and the map keeps the GPS drawing.

Usage: .venv/Scripts/python.exe scripts/fit-fia-track-outlines.py
"""
import io
import json
import math
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
import pdfplumber
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / '.apex-cache' / 'fia-maps'
PROFILES = ROOT / 'assets' / 'data' / 'track-profiles.json'
# Our round names where the FIA names the event differently.
ALIASES = {'Barcelona Grand Prix': 'Barcelona-Catalunya Grand Prix'}


def pdf_bytes(url):
    CACHE.mkdir(parents=True, exist_ok=True)
    name = re.sub(r'[^A-Za-z0-9_.-]+', '_', urllib.parse.unquote(url.rsplit('/', 1)[1]))
    path = CACHE / name
    if not path.exists():
        req = urllib.request.Request(url, headers={'User-Agent': 'apex-data-track-build'})
        path.write_bytes(urllib.request.urlopen(req, timeout=60).read())
    return path.read_bytes()


def map_page(data):
    pdf = pdfplumber.open(io.BytesIO(data))
    for page in pdf.pages:
        if 'CENTRELINE' in (page.extract_text() or '').upper():
            return page
    return None


def grey_value(colour):
    """A grey fill as one number (0-1), or None for a colour."""
    if isinstance(colour, (int, float)):
        return float(colour)
    if isinstance(colour, (list, tuple)) and len(colour) == 1:
        return float(colour[0])
    if isinstance(colour, (list, tuple)) and len(colour) == 3 and max(colour) - min(colour) < .02:
        return float(colour[0])
    if isinstance(colour, (list, tuple)) and len(colour) == 4 and max(colour[:3]) < .02:   # CMYK grey: K only
        return 1 - float(colour[3])
    return None


def band_points(page):
    """Points along the outline of the FIA's grey track band (page points, y down)."""
    groups = {}
    for obj in page.curves + page.rects:
        if not obj.get('fill'):
            continue
        g = grey_value(obj.get('non_stroking_color'))
        if g is None or not (.45 < g < .97):
            continue
        groups.setdefault(round(g, 2), []).append(obj)
    best, best_area = None, 0
    for g, objs in groups.items():
        pts = [p for o in objs for p in (o.get('pts') or [(o['x0'], o['top']), (o['x1'], o['bottom'])])]
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        w, h = max(xs) - min(xs), max(ys) - min(ys)
        if len(objs) >= 20 and w > 80 and h > 80 and w * h > best_area:
            best, best_area = objs, w * h
    if not best:
        return None
    out = []
    for o in best:
        pts = o.get('pts') or [(o['x0'], o['top']), (o['x1'], o['top']), (o['x1'], o['bottom']), (o['x0'], o['bottom'])]
        for a, b in zip(pts, pts[1:] + pts[:1]):
            n = max(1, int(math.hypot(b[0] - a[0], b[1] - a[1]) / .75))
            for k in range(n):
                out.append((a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n))
    return np.array(out)


def umeyama(src, dst):
    """Similarity transform (s, R, t) taking src onto dst, least squares, no reflection."""
    ms, md = src.mean(0), dst.mean(0)
    a, b = src - ms, dst - md
    u, d, vt = np.linalg.svd(b.T @ a / len(src))
    sign = np.diag([1, np.sign(np.linalg.det(u @ vt))])
    r = u @ sign @ vt
    s = (d * np.diag(sign)).sum() / a.var(0).sum()
    return s, r, md - s * r @ ms


def fit(lap, band):
    tree = cKDTree(band)
    span = lambda p: np.linalg.norm(p.max(0) - p.min(0))
    best = None
    for deg in range(0, 360, 2):
        th = math.radians(deg)
        r = np.array([[math.cos(th), -math.sin(th)], [math.sin(th), math.cos(th)]])
        p = lap @ r.T
        s = span(band) / span(p)
        t = band.mean(0) - s * p.mean(0)
        cost = np.median(tree.query(s * p + t)[0])
        if best is None or cost < best[0]:
            best = (cost, s, r, t)
    _, s, r, t = best
    for _ in range(60):
        q = s * lap @ r.T + t
        idx = tree.query(q)[1]
        s, r, t = umeyama(lap, band[idx])
    q = s * lap @ r.T + t
    dist = tree.query(q)[0]
    return s, r, t, q, float(np.median(dist)), tree


def snap(q, band, tree, radius):
    out = q.copy()
    for k, near in enumerate(tree.query_ball_point(q, radius)):
        if near:
            out[k] = band[near].mean(0)
    return out


def main():
    profiles = json.loads(PROFILES.read_text(encoding='utf-8'))
    year = profiles['year']
    circuits = {c['event']: c for c in json.loads((ROOT / 'data' / 'fia-circuit-maps' / f'{year}.json').read_text(encoding='utf-8'))['circuits']}
    for gp, t in profiles['tracks'].items():
        t['map'].pop('fia', None)
        c = circuits.get(gp) or circuits.get(ALIASES.get(gp, ''))
        outline = t['map'].get('outline') or []
        if not c or len(outline) < 50:
            print(f'{gp:28} no FIA map')
            continue
        page = map_page(pdf_bytes(c['source']))
        band = band_points(page) if page else None
        if band is None or len(band) < 200:
            print(f'{gp:28} no track band found on the map')
            continue
        lap = np.array([[p[0], -p[1]] for p in outline], float)   # page y runs down, GPS y up
        s, r, tr, q, median, tree = fit(lap, band)
        if median > 3:
            print(f'{gp:28} fit too loose ({median:.1f} pt), kept the GPS drawing')
            continue
        snapped = snap(q, band, tree, max(2.5, median * 3))
        corners = []
        for m in t['map'].get('corners') or []:
            cq = s * np.array([m['x'], -m['y']]) @ r.T + tr
            corners.append({'number': m['number'], 'x': round(float(cq[0]), 2), 'y': round(float(-cq[1]), 2)})
        t['map']['fia'] = {
            'outline': [[round(float(x), 2), round(float(-y), 2)] for x, y in snapped],
            'corners': corners,
            'fit': {'median_pt': round(median, 2), 'rotation_deg': round(math.degrees(math.atan2(r[1, 0], r[0, 0])), 1), 'source': c['source']},
        }
        print(f'{gp:28} fitted, median {median:.2f} pt, rotation {math.degrees(math.atan2(r[1, 0], r[0, 0])):.0f} deg')
    PROFILES.write_text(json.dumps(profiles, separators=(',', ':')) + '\n', encoding='utf-8')


if __name__ == '__main__':
    sys.exit(main())
