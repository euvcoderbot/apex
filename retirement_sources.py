"""Retirement causes as reported in Wikipedia's race classification tables.

The timing feeds and Jolpica (the Ergast successor) only say "Retired" for 2025-26, so the cause of a retirement is not in any
structured motorsport feed. Wikipedia's race article has a classification table whose Time/Retired column gives the reported
reason for each non-finisher ("Engine", "Collision", "Hydraulics"...). This module reads that table through the MediaWiki API and
returns, for each non-finisher, the reported reason together with the page revision it came from, so every cause shown can be
traced to the exact text used.

This is reported context, not a verified failure cause: callers must label it as such, accept it only when it agrees with the
timing data (car number, surname, laps completed), and fall back to the timing status when the page is missing or ambiguous.

Set APEX_RETIREMENT_SOURCES=off to disable all network access (tests, offline preparation).
"""
from __future__ import annotations

import json
import os
import re
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

API = "https://en.wikipedia.org/w/api.php"
# Wikimedia asks automated clients for a descriptive User-Agent that identifies the tool.
USER_AGENT = "ApexData/1.0 (+https://github.com/euvcoderbot/apex; F1 retirement causes)"
TTL_SECONDS = 12 * 3600
FAILURE_TTL_SECONDS = 15 * 60
NON_FINISH = {"ret", "dsq", "dns", "nc", "wd", "dnf", "ex", "dnq"}
_memory: dict[tuple[int, str], tuple[float, dict[str, Any] | None]] = {}


def enabled() -> bool:
    return os.environ.get("APEX_RETIREMENT_SOURCES", "on").strip().lower() not in ("off", "0", "false", "no")


def _cache_root() -> Path:
    if os.environ.get("VERCEL"):
        return Path("/tmp/apex-data/wikipedia")
    return Path(os.environ.get("APEX_WIKI_ROOT") or Path.home() / "apex-data" / "wikipedia")


def _api(params: dict[str, Any]) -> dict[str, Any]:
    url = API + "?" + urllib.parse.urlencode({**params, "format": "json", "formatversion": "2"})
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=8) as response:
        return json.loads(response.read().decode("utf-8"))


def fold(text: str) -> str:
    """Lower case without accents, for matching names (Pérez, Hülkenberg)."""
    return "".join(c for c in unicodedata.normalize("NFKD", str(text or "")) if not unicodedata.combining(c)).lower()


# ---------- wikitext ----------
def _top_level_split(text: str, separators: tuple[str, ...]) -> list[str]:
    """Split on separators that are not inside [[links]] or {{templates}}."""
    parts, depth_link, depth_tpl, start, i = [], 0, 0, 0, 0
    while i < len(text):
        two = text[i:i + 2]
        if two == "[[": depth_link += 1; i += 2; continue
        if two == "]]" and depth_link: depth_link -= 1; i += 2; continue
        if two == "{{": depth_tpl += 1; i += 2; continue
        if two == "}}" and depth_tpl: depth_tpl -= 1; i += 2; continue
        if not depth_link and not depth_tpl:
            sep = next((s for s in separators if text.startswith(s, i)), None)
            if sep:
                parts.append(text[start:i]); i += len(sep); start = i; continue
        i += 1
    parts.append(text[start:])
    return parts


def _cell_value(cell: str) -> str:
    """A table cell without its attributes: 'align="center" |41' -> '41'."""
    pieces = _top_level_split(cell, ("|",))
    if len(pieces) > 1 and re.search(r'^\s*(?:[\w-]+\s*=\s*("[^"]*"|\S+)\s*)+$', pieces[0]):
        return "|".join(pieces[1:])
    return cell


def clean(text: str) -> str:
    """Plain text from a wikitext cell: references, markup and decorative templates removed."""
    s = re.sub(r"<ref[^>]*/>", "", text)
    s = re.sub(r"<ref[^>]*>.*?</ref>", "", s, flags=re.S)
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    s = re.sub(r"<br\s*/?>", " ", s)
    s = re.sub(r"<[^>]+>", "", s)

    def template(match: re.Match) -> str:
        parts = match.group(1).split("|")
        name = parts[0].strip().lower()
        if name in ("nowrap", "small", "nobr", "big") and len(parts) > 1:
            return "|".join(parts[1:])
        if name in ("abbr", "tooltip", "abbrlink") and len(parts) > 1:
            return parts[1]
        if name in ("sortname",) and len(parts) > 2:
            return f"{parts[1]} {parts[2]}"
        return ""

    for _ in range(5):
        s = re.sub(r"\{\{([^{}]*)\}\}", template, s)
    s = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", s)
    s = s.replace("'''", "").replace("''", "").replace("&nbsp;", " ")
    return " ".join(s.split()).strip()


def _tables(wikitext: str) -> list[tuple[str, str]]:
    """(nearest heading, table text) for every top-level table."""
    out, heading, lines, current = [], "", wikitext.split("\n"), None
    for line in lines:
        stripped = line.strip()
        if current is None:
            m = re.match(r"^(=+)\s*(.*?)\s*\1\s*$", stripped)
            if m:
                heading = m.group(2)
            elif stripped.startswith("{|"):
                current = [line]
        else:
            current.append(line)
            if stripped.startswith("|}"):
                out.append((heading, "\n".join(current))); current = None
    return out


def _rows(table: str) -> list[list[str]]:
    rows, cells = [], []
    for line in table.split("\n")[1:]:
        stripped = line.strip()
        if stripped.startswith("|-") or stripped.startswith("|}"):
            if cells: rows.append(cells)
            cells = []
            continue
        if stripped.startswith("|+"):
            continue
        if stripped[:1] in ("|", "!"):
            for cell in _top_level_split(stripped[1:], ("||", "!!")):
                cells.append(clean(_cell_value(cell)))
        elif cells:
            cells[-1] = (cells[-1] + " " + clean(stripped)).strip()
    if cells: rows.append(cells)
    return rows


def parse_classification(wikitext: str) -> list[dict[str, Any]]:
    """Non-finishers from the race (not sprint, not qualifying) classification table."""
    candidates = []
    for heading, table in _tables(wikitext):
        rows = _rows(table)
        if not rows: continue
        header = [h.lower() for h in rows[0]]
        if not any("retired" in h for h in header) or not any(h.startswith("laps") for h in header):
            continue
        heading_l = heading.lower()
        if "sprint" in heading_l or "qualif" in heading_l:
            continue
        candidates.append((heading_l, header, rows[1:]))
    if not candidates:
        return []
    heading, header, body = next((c for c in candidates if "race" in c[0]), candidates[-1])
    index = lambda test: next((i for i, h in enumerate(header) if test(h)), None)
    pos_i, no_i = index(lambda h: h.startswith("pos")), index(lambda h: h.startswith("no"))
    driver_i, laps_i, reason_i = index(lambda h: h.startswith("driver")), index(lambda h: h.startswith("laps")), index(lambda h: "retired" in h)
    if None in (pos_i, no_i, driver_i, laps_i, reason_i):
        return []
    out = []
    for cells in body:
        if len(cells) <= max(pos_i, no_i, driver_i, laps_i, reason_i):
            continue
        position = cells[pos_i].strip()
        reason_text = cells[reason_i].strip()
        # A classified finisher's column holds a race time or a gap; a car that stopped late but still completed 90% of the
        # distance is classified with a position and the reason in the same column ("15 ... Hydraulics").
        is_gap = re.fullmatch(r"(\d+:)?\d{1,2}:\d{2}\.\d+|\+\s*[\d.:]+\s*(s|laps?)?|\+?\s*\d+\s+laps?", reason_text, re.I)
        if position.lower() not in NON_FINISH and (not position.isdigit() or is_gap or not reason_text):
            continue
        number = re.sub(r"\D", "", cells[no_i])
        laps = re.sub(r"\D", "", cells[laps_i])
        reason = cells[reason_i].strip()
        # A not-classified car's column holds its gap ("+11 laps"), not a cause.
        if not number or not reason or re.fullmatch(r"\+?\s*\d+\s+laps?", reason, re.I):
            continue
        out.append({"position": position, "number": number, "driver": cells[driver_i], "laps": int(laps) if laps else None, "reason": reason})
    return out


# ---------- fetching ----------
def _resolve_title(year: int, event_name: str) -> str | None:
    title = f"{year} {event_name}"
    found = _api({"action": "query", "titles": title, "redirects": 1})
    pages = found.get("query", {}).get("pages", [])
    if pages and not pages[0].get("missing"):
        return pages[0]["title"]
    search = _api({"action": "query", "list": "search", "srsearch": f"{year} {event_name}", "srlimit": 5})
    for hit in search.get("query", {}).get("search", []):
        if hit["title"].startswith(str(year)) and "Grand Prix" in hit["title"]:
            return hit["title"]
    return None


def _fetch(year: int, event_name: str) -> dict[str, Any] | None:
    title = _resolve_title(year, event_name)
    if not title:
        return None
    page = _api({"action": "parse", "page": title, "prop": "wikitext|revid", "redirects": 1})["parse"]
    revid = page.get("revid")
    return {
        "title": page["title"], "revid": revid,
        "url": f"https://en.wikipedia.org/w/index.php?title={urllib.parse.quote(page['title'].replace(' ', '_'))}&oldid={revid}",
        "fetched_at": time.time(),
        "retirements": parse_classification(page["wikitext"]),
    }


def reported_retirements(year: int | None, event_name: str | None) -> dict[str, Any] | None:
    """{'title', 'revid', 'url', 'retirements': [...]} for a race, or None when unavailable. Cached on disk for 12 hours."""
    if not enabled() or not year or not event_name:
        return None
    key = (int(year), str(event_name))
    hit = _memory.get(key)
    if hit and time.time() - hit[0] < (TTL_SECONDS if hit[1] else FAILURE_TTL_SECONDS):
        return hit[1]
    path = _cache_root() / f"{int(year)}-{re.sub(r'[^a-z0-9]+', '-', fold(event_name)).strip('-')}.json"
    saved = None
    try:
        saved = json.loads(path.read_text("utf-8"))
        if time.time() - float(saved.get("fetched_at", 0)) < TTL_SECONDS:
            _memory[key] = (time.time(), saved)
            return saved
    except (OSError, ValueError):
        saved = None
    try:
        fresh = _fetch(int(year), str(event_name))
    except Exception:
        fresh = None
    if fresh and fresh.get("retirements") is not None:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix(".tmp")
            temporary.write_text(json.dumps(fresh), "utf-8")
            temporary.replace(path)
        except OSError:
            pass
        _memory[key] = (time.time(), fresh)
        return fresh
    # Offline or Wikipedia unavailable: an older copy is still the best evidence there is.
    _memory[key] = (time.time(), saved)
    return saved


def match(report: dict[str, Any] | None, number: Any, last_name: str, laps: Any) -> dict[str, Any] | None:
    """The reported row for this car, only if car number, surname and laps completed agree with the timing data."""
    if not report:
        return None
    number = re.sub(r"\D", "", str(number or ""))
    row = next((r for r in report.get("retirements", []) if r["number"] == number), None)
    if not row:
        return None
    if last_name and fold(last_name) not in fold(row["driver"]):
        return None
    try:
        timed = int(float(laps)) if laps is not None and str(laps) != "nan" else None
    except (TypeError, ValueError):
        timed = None
    if timed is not None and row["laps"] is not None and abs(timed - row["laps"]) > 1:
        return None
    return row
