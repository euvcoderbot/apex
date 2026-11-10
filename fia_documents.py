"""FIA Formula 1 documents: car upgrades (Car Presentation Submissions) and power-unit elements used per driver.

Both are published as PDFs on fia.com for every Grand Prix. They are downloaded once (a finished event's documents do not
change), parsed with pdfplumber, and kept on disk as JSON.

- Car Presentation Submissions: one page (or more) per team listing each updated component, its primary reason (for
  example "Performance - Flow Conditioning"), the geometric difference and a short description.
- PU elements used per driver up to now: one table of counts per element (ICE, TC, EXH, MGU-K, ES, PU-CE, PU-ANC).
"""
from __future__ import annotations

import gzip
import io
import json
import re
import time
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote, unquote
from urllib.request import Request, urlopen

FIA = 'https://www.fia.com'
CHAMPIONSHIP = FIA + '/documents/championships/fia-formula-one-world-championship-14'
MONTHS = {m: i for i, m in enumerate(('january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
                                      'october', 'november', 'december'), 1)}
# FIA team names to the constructor ids used everywhere else (Jolpica), most specific first.
TEAM_KEYS = (('racing bulls', 'rb'), ('visa cash app', 'rb'), ('vcarb', 'rb'), ('alphatauri', 'rb'), ('red bull', 'red_bull'), ('mclaren', 'mclaren'), ('ferrari', 'ferrari'), ('mercedes', 'mercedes'),
             ('aston martin', 'aston_martin'), ('alpine', 'alpine'), ('williams', 'williams'), ('haas', 'haas'), ('audi', 'audi'),
             ('sauber', 'sauber'), ('cadillac', 'cadillac'), ('kick', 'sauber'), ('stake', 'sauber'))
PU_ELEMENTS = ('ICE', 'TC', 'EXH', 'MGU-K', 'ES', 'PU-CE', 'PU-ANC')


def _get(url: str, binary: bool = False) -> Any:
    request = Request(url, headers={'User-Agent': 'Mozilla/5.0 (F1 Apex Data; FIA document reader)'})
    with urlopen(request, timeout=60) as response:
        body = response.read()
    return body if binary else body.decode('utf-8', 'replace')


def _unquote(text: str) -> str:
    """FIA event links are percent-encoded in UTF-8 or, for some names (S%E3o Paulo), Latin-1."""
    try:
        return unquote(text, errors='strict')
    except UnicodeDecodeError:
        return unquote(text, encoding='latin-1')


def _event_encoding(event: str) -> str:
    return 'latin-1' if any(ord(c) > 127 for c in event) else 'utf-8'


# The FIA's reasons, as teams fill them in: a category, often followed by a detail ("Performance - Local Load").
REASON_TYPES = (('circuit', 'Circuit specific'), ('reliab', 'Reliability'), ('cooling', 'Cooling range'), ('balance', 'Balance range'),
                ('performance', 'Performance'), ('flow conditioning', 'Performance'), ('local load', 'Performance'), ('drag', 'Performance'))


def reason_type(*texts: str) -> str:
    """The canonical category, from the reason first and then the rest of the row (some tables shift a column)."""
    for text in texts:
        low = (text or '').lower()
        for word, kind in REASON_TYPES:
            if word in low:
                return kind
    return 'Unspecified'


def event_key(name: str) -> str:
    """'Barcelona-Catalunya Grand Prix' and 'Barcelona Grand Prix' -> 'barcelona'; for matching FIA events to rounds."""
    text = _ascii(name or '').lower().replace('grand prix', ' ')
    return (re.findall(r'[a-z]+', text) or [''])[0]


def _undouble(text: str) -> str:
    """Some cells are read twice ('Rear Impact Structure Rear Impact Structure'): keep one copy."""
    t = ' '.join(str(text or '').split())
    half = len(t) // 2
    return t[:half].strip() if len(t) > 3 and len(t) % 2 == 1 and t[:half] == t[half + 1:] else t


def repair_item(item: dict) -> dict | None:
    """One car-presentation row, tidied: doubled text collapsed, a row whose columns slid one to the right (the row number
    read as the reason, the component as the geometry) put back, and rows with nothing in them dropped."""
    row = {k: (_undouble(v) if isinstance(v, str) else v) for k, v in item.items()}
    if not any(row.get(k) for k in ('component', 'geometry', 'description')):
        return None
    if (not row.get('component') or row['component'].isdigit()) and (row.get('reason') or '').isdigit() and row.get('geometry'):
        detail = row.get('description') or ''
        reason = re.match(r'(performance|circuit specific|reliability|cooling range|balance range)(\s*-\s*(?:local load|flow conditioning|drag reduction|drag|downforce|cooling|brake cooling|aero efficiency|load))?\s*', detail, re.I)
        row['component'] = row['geometry']
        row['reason'] = ' '.join(reason.group(0).split()) if reason else ''   # the category and its detail ('Performance - Local Load')
        row['geometry'] = detail[reason.end():].strip() if reason else ''
        row['description'] = row['geometry']
        row['reason_type'] = reason_type(row['reason'], detail)
        if reason and ' - ' in row['reason']:
            row['reason_detail'] = row['reason'].split(' - ', 1)[1].strip()
    if row.get('component', '').isdigit():
        row['component'] = ''
    return row


def team_id(name: str) -> str | None:
    text = (name or '').lower()
    return next((key for word, key in TEAM_KEYS if word in text), None)


def _ascii(text: str) -> str:
    return unicodedata.normalize('NFKD', text or '').encode('ascii', 'ignore').decode()


class Documents:
    def __init__(self, cache_dir: Path | None = None, get: Callable[..., Any] | None = None, now: Callable[[], float] = time.time):
        self.cache_dir, self.http, self.now = cache_dir, get or _get, now
        if cache_dir:
            cache_dir.mkdir(parents=True, exist_ok=True)

    # ---- cache ----
    def _cached(self, name: str, ttl: float | None, build: Callable[[], Any]) -> Any:
        path = self.cache_dir / f'{name}.json.gz' if self.cache_dir else None
        if path and path.exists() and (ttl is None or self.now() - path.stat().st_mtime < ttl):
            try:
                with gzip.open(path, 'rt', encoding='utf-8') as handle:
                    return json.load(handle)
            except (OSError, ValueError):
                path.unlink(missing_ok=True)
        value = build()
        if path and value is not None:
            with gzip.open(path, 'wt', encoding='utf-8') as handle:
                json.dump(value, handle)
        return value

    # ---- listings ----
    def season_url(self, year: int) -> str:
        def build():
            page = self.http(CHAMPIONSHIP)
            ids = [int(i) for y, i in re.findall(r'season-(\d{4})-(\d+)', page) if int(y) == year]
            if not ids:
                raise LookupError(f'The FIA has no {year} document season.')
            return f'{CHAMPIONSHIP}/season/season-{year}-{max(ids)}'
        return self._cached(f'fia-season-{year}', 7 * 86400, build)

    def events(self, year: int) -> list[str]:
        def build():
            page = self.http(self.season_url(year))
            return sorted({_unquote(e) for e in re.findall(r'/event/([^"?#]+)"', page)})
        return self._cached(f'fia-events-{year}', 3600, build)

    def event_documents(self, year: int, event: str, finished: bool) -> list[str]:
        def build():
            page = self.http(f'{self.season_url(year)}/event/{quote(event, encoding=_event_encoding(event))}')
            # 2025 on: /system/files/decision-document/2025_hungarian_grand_prix_-_....pdf; before that
            # /sites/default/files/decision-document/2024 Hungarian Grand Prix - Car Presentation Submissions.pdf.
            return sorted(set(re.findall(r'href="(/(?:system|sites/default)/files/decision-document/[^"]+\.pdf)"', page)))
        # A finished event's list is final; the current one gains documents through the weekend.
        return self._cached(f'fia-docs2-{year}-{_ascii(event)}', None if finished else 1800, build)

    def pdf(self, path: str) -> bytes:
        return self.http(FIA + quote(_unquote(path), safe='/'), binary=True)

    # ---- car presentation submissions ----
    def upgrades(self, year: int, finished: Callable[[str], bool] = lambda event: True) -> list[dict]:
        updates = []
        for event in self.events(year):
            docs = [d for d in self.event_documents(year, event, finished(event)) if 'car_presentation' in doc_kind(d)]
            if not docs:
                continue
            path = sorted(docs, key=lambda d: (len(d), d))[-1]   # a corrected re-issue (_1, _2) replaces the first
            parsed = self._cached(f'fia-upgrades2-{_cache_name(path)}', None,   # 2: header-less pages are read too
                                  lambda: parse_car_presentation(self.pdf(path)))
            for item in filter(None, map(repair_item, parsed['items'])):
                updates.append({'event': event, 'event_dates': parsed['dates'], 'document': FIA + path, **item})
        return updates

    # ---- power-unit elements ----
    def pu_elements(self, year: int, finished: Callable[[str], bool] = lambda event: True) -> dict | None:
        best = None
        for event in self.events(year):
            docs = [d for d in self.event_documents(year, event, finished(event)) if 'pu_elements_used' in doc_kind(d)]
            if not docs:
                continue
            path = sorted(docs, key=lambda d: (len(d), d))[-1]
            parsed = self._cached(f'fia-pu-{_cache_name(path)}', None, lambda: parse_pu_elements(self.pdf(path)))
            if parsed and parsed.get('dates') and (best is None or parsed['dates'][1] > best['dates'][1]):
                best = {**parsed, 'event': event, 'document': FIA + path}
        return best


    def pu_history(self, year: int, finished: Callable[[str], bool] = lambda event: True) -> list[dict]:
        """Every event's 'PU elements used' table (cumulative counts), oldest first."""
        out = []
        for event in self.events(year):
            docs = [d for d in self.event_documents(year, event, finished(event)) if 'pu_elements_used' in doc_kind(d)]
            if not docs:
                continue
            path = sorted(docs, key=lambda d: (len(d), d))[-1]
            parsed = self._cached(f'fia-pu-{_cache_name(path)}', None, lambda: parse_pu_elements(self.pdf(path)))
            if parsed and parsed.get('dates'):
                out.append({'event': event, 'dates': parsed['dates'], 'elements': parsed['elements'], 'rows': parsed['rows']})
        return sorted(out, key=lambda e: e['dates'][1])


# ---------- parsing ----------
def _cache_name(path: str) -> str:
    return re.sub(r'[^A-Za-z0-9._-]+', '_', _ascii(_unquote(path.rsplit('/', 1)[-1])))


def doc_kind(path: str) -> str:
    """A document's file name, normalised across the FIA's naming eras: lower case, words joined by underscores."""
    return re.sub(r'[^a-z0-9]+', '_', _unquote(path.rsplit('/', 1)[-1]).lower())


def _dates(text: str) -> list[str] | None:
    """'06 - 08 November 2026' or '30 October - 01 November 2026' as [first day, last day] (ISO)."""
    m = re.search(r'(\d{1,2})\s*(?:([A-Za-z]+)\s*)?-\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})', text)
    if not m:
        return None
    d1, m1, d2, m2, year = m.groups()
    month2 = MONTHS.get(m2.lower())
    month1 = MONTHS.get((m1 or m2).lower())
    if not month1 or not month2:
        return None
    y1 = int(year) - (1 if month1 > month2 else 0)
    return [f'{y1}-{month1:02d}-{int(d1):02d}', f'{int(year)}-{month2:02d}-{int(d2):02d}']


def _clean(text: Any) -> str:
    return re.sub(r'\s+', ' ', str(text or '').replace('�', '-').replace('–', '-').replace('—', '-')).strip()


def parse_car_presentation(data: bytes) -> dict:
    import pdfplumber
    items, team, dates, teams, unreadable = [], None, None, {}, 0
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for number, page in enumerate(pdf.pages):
            text = page.extract_text() or ''
            if number == 0:
                dates = _dates(text)
                continue
            if not text.strip():
                unreadable += 1   # a scanned image page: nothing to read without OCR
                if team and teams.get(team_id(team)) == 'updates':
                    teams[team_id(team)] = 'partly unreadable'
                continue
            lines = [line.strip() for line in text.splitlines() if line.strip()]
            # The team's name heads its pages: the line just above the table header ('Updated ...') or 'No updates
            # submitted', whether or not a 'Car presentation' title comes first (2026) or only on the first page (2024).
            # A name we do not recognise still starts a new team, so its rows are left out rather than misattributed.
            heading = next((lines[i] for i in range(min(5, len(lines) - 1)) if re.match(r'(updated|no updates?)', lines[i + 1], re.I)), None)
            if heading is None:
                heading = next((line for line in lines[:3] if team_id(line) and not line.lower().startswith('car presentation')), None)
            if heading and len(heading) < 70 and not heading.lower().startswith('car presentation'):
                team = heading
            if team and team_id(team):
                no_updates = re.search(r'no updates?\b', text, re.I) is not None
                teams.setdefault(team_id(team), 'none' if no_updates else 'updates')
            for table in page.extract_tables():
                header = next((row for row in table[:3] if any('Updated' in (c or '') for c in row)), None)
                if header:
                    marks = [i for i, c in enumerate(header) if c and c.strip()]   # Updated / Primary reason / Geometric / Brief description
                    if len(marks) < 4:
                        continue
                    spans = [(marks[0] - 1, marks[1] - 1), (marks[1] - 1, marks[2] - 1), (marks[2] - 1, marks[3] - 1), (marks[3] - 1, len(header))]
                else:
                    # Some teams' pages carry no header row (Red Bull in 2025, and continuation pages): take the columns from the
                    # first numbered row, whose four filled cells after the number are component, reason, geometry and
                    # description. Tables without numbered rows (the small boxes pdfplumber also finds) are skipped.
                    first = next((row for row in table if (row[0] or '').strip().isdigit()), None)
                    cells = [i for i, c in enumerate(first) if i and c and c.strip()] if first else []
                    if len(cells) < 4 or not team or not team_id(team):
                        continue
                    spans = [(cells[0], cells[1]), (cells[1], cells[2]), (cells[2], cells[3]), (cells[3], len(first))]
                current = None
                for row in table:
                    if row is header or any(c and ('component' in c or 'for update' in c or 'previous version' in c) for c in row if c):
                        continue
                    fields = [_clean(' '.join(c for c in row[a:b] if c)) for a, b in spans]
                    if (row[0] or '').strip().isdigit():
                        current = {'team_name': team, 'team': team_id(team or ''), 'component': fields[0], 'reason': fields[1],
                                   'geometry': fields[2], 'description': fields[3]}
                        items.append(current)
                    elif current:
                        for key, value in zip(('component', 'reason', 'geometry', 'description'), fields):
                            if value:
                                current[key] = _clean(f'{current[key]} {value}')
    for item in items:
        reason = item['reason'].replace(' -', ' - ').replace('- ', ' - ')
        kind, _, detail = (part.strip() for part in reason.partition(' - '))
        item['reason'] = _clean(reason)
        item['reason_type'] = reason_type(item['reason'], item['geometry'], item['description'], item['component'])
        item['reason_detail'] = detail.title() if detail and not detail[:1].isdigit() else ''
    return {'dates': dates, 'items': items, 'teams': teams, 'unreadable_pages': unreadable}


def parse_pu_elements(data: bytes) -> dict | None:
    import pdfplumber
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        dates = _dates(pdf.pages[0].extract_text() or '')
        page = next((p for p in pdf.pages if 'power unit elements' in (p.extract_text() or '').lower()), pdf.pages[-1])
        words = page.extract_words(keep_blank_chars=False)
    # Column centres from the header words (some names span two lines: "MGU"/"-K", "PU-"/"CE", "PU-"/"ANC").
    anchor = next((w for w in words if w['text'] == 'Driver'), None)
    if anchor is None:
        return None
    near = [w for w in words if abs(w['top'] - anchor['top']) < 16]   # the table header spans two lines around "Driver"
    # 2026 on: ICE TC EXH MGU-K ES PU-CE PU-ANC. 2014-2025: ICE TC MGU-H MGU-K ES CE EX.
    era_2026 = any(w['text'] in ('ANC', 'PU-ANC', 'EXH') for w in near)
    names = {'ICE': 'ICE', 'TC': 'TC', 'EXH': 'EXH', 'EX': 'EX', 'ES': 'ES', '-K': 'MGU-K', 'MGU-K': 'MGU-K', '-H': 'MGU-H', 'MGU-H': 'MGU-H',
             'CE': 'PU-CE' if era_2026 else 'CE', 'PU-CE': 'PU-CE', 'ANC': 'PU-ANC', 'PU-ANC': 'PU-ANC'}
    header = {}
    for w in near:
        name = names.get(w['text'])
        if name:
            header.setdefault(name, (w['x0'] + w['x1']) / 2)
    if len(header) < 6:
        return None
    columns = sorted(header.items(), key=lambda kv: kv[1])
    lines: dict[int, list[dict]] = {}
    for w in words:
        lines.setdefault(round(w['top'] / 3), []).append(w)
    rows = []
    for _, ws in sorted(lines.items()):
        ws.sort(key=lambda w: w['x0'])
        if not ws or not re.fullmatch(r'\d{1,2}', ws[0]['text']):
            continue
        counts = [w for w in ws[1:] if re.fullmatch(r'\d{1,2}', w['text']) and w['x0'] > columns[0][1] - 25]
        label = [w['text'] for w in ws[1:] if w not in counts]
        if len(counts) < len(columns) - 1:
            continue
        values = {}
        for w in counts:
            centre = (w['x0'] + w['x1']) / 2
            name = min(columns, key=lambda c: abs(c[1] - centre))[0]
            values[name] = int(w['text'])
        rows.append({'number': str(int(ws[0]['text'])), 'label': ' '.join(label), 'team': team_id(' '.join(label)), 'elements': values})
    return {'dates': dates, 'elements': [name for name, _ in columns], 'rows': rows}
