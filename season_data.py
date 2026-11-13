"""Season data: schedule, results, standings, driver statistics and head-to-heads.

Source: Jolpica (api.jolpi.ca, the maintained Ergast successor) for the calendar, race, sprint and qualifying
classifications. Everything else here is calculated from those classifications, the same way for every season:

- Standings after each round add race and sprint points; ties are broken as the FIA does, by countback (most wins,
  then most second places, and so on, race results only).
- Season stat cards, per-driver statistics and teammate head-to-heads are derived from the same rows, so every number
  can be traced to a classification.
"""
from __future__ import annotations

import gzip
import json
import re
import time
from collections import defaultdict
from datetime import timedelta, datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError
from urllib.request import Request, urlopen

JOLPICA = 'https://api.jolpi.ca/ergast/f1'
PAGE = 100
NOT_CLASSIFIED = {'R', 'D', 'E', 'W', 'F', 'N'}   # Retired, Disqualified, Excluded, Withdrawn, Failed to qualify, Not classified


def team_name(name: str) -> str:
    """Short, everyday constructor names ('RB F1 Team' -> 'Racing Bulls', 'Haas F1 Team' -> 'Haas')."""
    if name in TEAM_NAMES:
        return TEAM_NAMES[name]
    return re.sub(r'\s+F1 Team$', '', name).strip() or name


TEAM_NAMES = {'RB F1 Team': 'Racing Bulls'}


SESSION_KEYS = (('FirstPractice', 'Practice 1'), ('SecondPractice', 'Practice 2'), ('ThirdPractice', 'Practice 3'),
                ('SprintQualifying', 'Sprint Qualifying'), ('Sprint', 'Sprint'), ('Qualifying', 'Qualifying'))


# ---------- fetching (cached on disk; the current season refreshes, finished seasons are kept) ----------
def _fetch_json(url: str, attempts: int = 4) -> dict:
    """JSON from Jolpica (or Open-Meteo); a rate-limit answer (429) waits and tries again: Jolpica allows a few requests a second."""
    request = Request(url, headers={'User-Agent': 'F1-Apex-Data/1.0 (season statistics)', 'Accept': 'application/json'})
    for attempt in range(attempts):
        try:
            with urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode('utf-8'))
        except HTTPError as error:
            if error.code != 429 or attempt == attempts - 1:
                raise
            wait = error.headers.get('Retry-After') or ''
            time.sleep(min(float(wait), 10) if wait.replace('.', '', 1).isdigit() else 1.5 * (attempt + 1))
    raise RuntimeError('unreachable')


class Source:
    """Jolpica pages with a small disk cache. `fetch` is injectable for tests."""

    def __init__(self, cache_dir: Path | None = None, fetch: Callable[[str], dict] | None = None, now: Callable[[], float] = time.time):
        self.cache_dir, self.fetch, self.now = cache_dir, fetch or _fetch_json, now
        if cache_dir:
            cache_dir.mkdir(parents=True, exist_ok=True)

    def _ttl(self, year: int) -> float:
        return 900 if year >= datetime.now(timezone.utc).year else 30 * 86400

    def get(self, year: int, path: str, ttl: float | None = None) -> dict:
        key = self.cache_dir / f"jolpica-{year}-{path.replace('/', '_').replace('?', '_').replace('&', '_').replace('=', '-')}.json.gz" if self.cache_dir else None
        if key and key.exists() and self.now() - key.stat().st_mtime < (ttl if ttl is not None else self._ttl(year)):
            try:
                with gzip.open(key, 'rt', encoding='utf-8') as handle:
                    return json.load(handle)
            except (OSError, ValueError):
                key.unlink(missing_ok=True)
        data = self.fetch(f'{JOLPICA}/{year}/{path}')
        if key:
            with gzip.open(key, 'wt', encoding='utf-8') as handle:
                json.dump(data, handle)
        return data

    def get_global(self, path: str, ttl: float = 7 * 86400) -> dict:
        """A path outside any one season (circuit histories), cached for a week."""
        key = self.cache_dir / f"jolpica-all-{re.sub(r'[^a-z0-9]+', '_', path.lower())}.json.gz" if self.cache_dir else None
        if key and key.exists() and self.now() - key.stat().st_mtime < ttl:
            try:
                with gzip.open(key, 'rt', encoding='utf-8') as handle:
                    return json.load(handle)
            except (OSError, ValueError):
                key.unlink(missing_ok=True)
        data = self.fetch(f'{JOLPICA}/{path}')
        if key:
            with gzip.open(key, 'wt', encoding='utf-8') as handle:
                json.dump(data, handle)
        return data

    def races(self, year: int, kind: str) -> list[dict]:
        """Every race of a paged table (results / qualifying / sprint), merged by round: one race can span two pages."""
        merged: dict[int, dict] = {}
        offset, total = 0, None
        while total is None or offset < total:
            data = self.get(year, f'{kind}/?limit={PAGE}&offset={offset}')['MRData']
            total = int(data.get('total') or 0)
            for race in data.get('RaceTable', {}).get('Races', []):
                key = int(race['round'])
                rows_key = {'results': 'Results', 'qualifying': 'QualifyingResults', 'sprint': 'SprintResults'}[kind]
                if key in merged:
                    merged[key][rows_key].extend(race.get(rows_key, []))
                else:
                    merged[key] = race
            offset += PAGE
            if not total:
                break
        return [merged[k] for k in sorted(merged)]


# ---------- normalising ----------
def _int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _seconds(text: Any) -> float | None:
    """'1:23.456' or '83.456' as seconds."""
    if not text:
        return None
    try:
        minutes, _, rest = str(text).rpartition(':')
        return (int(minutes) * 60 if minutes else 0) + float(rest)
    except ValueError:
        return None


def _driver(row: dict) -> dict:
    d = row['Driver']
    return {'id': d['driverId'], 'code': d.get('code') or d['familyName'][:3].upper(), 'number': d.get('permanentNumber') or row.get('number'),
            'name': f"{d['givenName']} {d['familyName']}", 'family': d['familyName'], 'nationality': d.get('nationality')}


def _classified_row(row: dict) -> dict:
    position_text = row.get('positionText') or row.get('position')
    classified = position_text not in NOT_CLASSIFIED
    time_block = row.get('Time') or {}
    fastest = row.get('FastestLap') or {}
    return {
        'driver': row['Driver']['driverId'], 'team': row['Constructor']['constructorId'],
        'position': _int(row.get('position')) if classified else None, 'position_text': position_text,
        'grid': _int(row.get('grid')), 'points': _float(row.get('points')), 'laps': _int(row.get('laps')) or 0,
        'status': row.get('status'), 'time_ms': _int(time_block.get('millis')), 'gap': time_block.get('time'),
        'fastest_lap_rank': _int(fastest.get('rank')),
    }


def started(row: dict) -> bool:
    """False for an entry that never took the start (DNS, withdrawn): it is not a race retirement."""
    return (row.get('status') or '').lower() not in {'did not start', 'withdrew', 'withdrawn'} and row.get('position_text') != 'W'


def field_size(rows: list[dict]) -> int:
    return sum(1 for x in rows if started(x)) or len(rows)


def _qualifying_row(row: dict) -> dict:
    times = [_seconds(row.get(k)) for k in ('Q1', 'Q2', 'Q3')]
    return {'driver': row['Driver']['driverId'], 'team': row['Constructor']['constructorId'], 'position': _int(row.get('position')),
            'q1': times[0], 'q2': times[1], 'q3': times[2], 'reached': 3 if times[2] else 2 if times[1] else 1}


def load_season(year: int, source: Source) -> dict:
    """The calendar with each round's race, sprint and qualifying classifications, plus every driver and team seen."""
    calendar = source.get(year, f'races/?limit={PAGE}')['MRData']['RaceTable']['Races']
    results = {int(r['round']): r for r in source.races(year, 'results')}
    qualifying = {int(r['round']): r for r in source.races(year, 'qualifying')}
    sprints = {int(r['round']): r for r in source.races(year, 'sprint')}
    drivers: dict[str, dict] = {}
    teams: dict[str, dict] = {}
    rounds = []
    now = datetime.now(timezone.utc)
    for race in calendar:
        n = int(race['round'])
        rows = results.get(n, {}).get('Results', [])
        sprint_rows = sprints.get(n, {}).get('SprintResults', [])
        quali_rows = qualifying.get(n, {}).get('QualifyingResults', [])
        for row in [*rows, *sprint_rows, *quali_rows]:
            info = _driver(row)
            drivers.setdefault(info['id'], info)['team'] = row['Constructor']['constructorId']   # latest team wins
            teams.setdefault(row['Constructor']['constructorId'], {'id': row['Constructor']['constructorId'], 'name': team_name(row['Constructor']['name']),
                                                                  'nationality': row['Constructor'].get('nationality')})
        loc = race['Circuit']['Location']
        start = f"{race['date']}T{race.get('time', '12:00:00Z')}"
        sessions = [{'name': label, 'start': f"{race[key]['date']}T{race[key].get('time', '12:00:00Z')}"} for key, label in SESSION_KEYS if key in race]
        sessions.append({'name': 'Race', 'start': start})
        rounds.append({
            'round': n, 'name': race['raceName'], 'circuit': race['Circuit']['circuitName'], 'circuit_id': race['Circuit']['circuitId'],
            'locality': loc.get('locality'), 'country': loc.get('country'), 'lat': _float(loc.get('lat')), 'lon': _float(loc.get('long')),
            'date': race['date'], 'start': start, 'sprint_weekend': any(s['name'] == 'Sprint' for s in sessions),
            'sessions': sorted(sessions, key=lambda s: s['start']),
            'race': [_classified_row(r) for r in rows], 'sprint': [_classified_row(r) for r in sprint_rows],
            'qualifying': [_qualifying_row(r) for r in quali_rows],
            'status': 'done' if rows else ('next' if not any(r.get('status') == 'next' for r in rounds) and _parse(start) > now else 'upcoming'),
        })
    # 'next' is the first round without results whose race is still ahead; earlier unresulted rounds are pending results.
    seen_next = False
    for r in rounds:
        if r['race']:
            continue
        if not seen_next and _parse(r['start']) > now:
            r['status'], seen_next = 'next', True
        elif _parse(r['start']) <= now:
            r['status'] = 'awaiting'
        else:
            r['status'] = 'upcoming'
    return {'year': year, 'rounds': rounds, 'drivers': drivers, 'teams': teams}


def _parse(stamp: str) -> datetime:
    return datetime.fromisoformat(stamp.replace('Z', '+00:00'))


# ---------- standings: after every round, with the FIA's countback ----------
def _standings_after(rounds: list[dict], kind: str) -> list[dict]:
    """[{round, table: [{id, points, position, wins}]}] for 'driver' or 'team' after each completed round."""
    key = 'driver' if kind == 'driver' else 'team'
    points: dict[str, float] = defaultdict(float)
    finishes: dict[str, list[int]] = defaultdict(list)
    out = []
    for r in rounds:
        if not r['race']:
            continue
        for row in [*r['race'], *r['sprint']]:
            points[row[key]] += row['points']
        for row in r['race']:
            if row['position']:
                finishes[row[key]].append(row['position'])
        # Countback: compare counts of 1st places, then 2nd places, ... (race classifications).
        def order(entry: str):
            counts = [finishes[entry].count(p) for p in range(1, 31)]
            return (-points[entry], *[-c for c in counts])
        ranked = sorted(points, key=order)
        out.append({'round': r['round'], 'table': [{'id': entry, 'points': round(points[entry], 1), 'position': i + 1,
                                                     'wins': finishes[entry].count(1)} for i, entry in enumerate(ranked)]})
    return out


# ---------- the season summary ----------
def season_summary(data: dict) -> dict:
    rounds, drivers, teams = data['rounds'], data['drivers'], data['teams']
    done = [r for r in rounds if r['race']]
    driver_evo, team_evo = _standings_after(rounds, 'driver'), _standings_after(rounds, 'team')
    winners = []
    for r in rounds:
        race_win = next((x for x in r['race'] if x['position'] == 1), None)
        sprint_win = next((x for x in r['sprint'] if x['position'] == 1), None)
        pole = next((x for x in r['qualifying'] if x['position'] == 1), None)
        sprint_pole = next((x for x in r['sprint'] if x['grid'] == 1), None)
        winners.append({'round': r['round'], 'race_winner': race_win and race_win['driver'], 'race_team': race_win and race_win['team'],
                        'sprint_winner': sprint_win and sprint_win['driver'], 'pole': pole and pole['driver'],
                        'sprint_pole': sprint_pole and sprint_pole['driver'], 'margin': _margin(r['race'])})
    return {'year': data['year'], 'rounds': rounds, 'drivers': drivers, 'teams': teams,
            'standings': {'drivers': driver_evo, 'teams': team_evo},
            'winners': winners, 'cards': _season_cards(done, drivers, teams),
            'driver_stats': {d: driver_stats(data, d, driver_evo) for d in drivers},
            'teammates': teammate_pairs(data), 'completed': len(done), 'total_rounds': len(rounds)}


def _margin(rows: list[dict]) -> float | None:
    """Winning margin in seconds: the runner-up's race time minus the winner's (only when P2 finished on the lead lap)."""
    first = next((x for x in rows if x['position'] == 1), None)
    second = next((x for x in rows if x['position'] == 2), None)
    if first and second and first['time_ms'] and second['time_ms'] and second['laps'] == first['laps']:
        return round((second['time_ms'] - first['time_ms']) / 1000, 3)
    return None


def _season_cards(done: list[dict], drivers: dict, teams: dict) -> dict:
    def tally(rows_of, key, test):
        counts: dict[str, int] = defaultdict(int)
        for r in done:
            for row in rows_of(r):
                if test(row):
                    counts[row[key]] += 1
        return counts

    def leader(counts):
        if not counts:
            return None
        best = max(counts.values())
        return {'ids': sorted([k for k, v in counts.items() if v == best]), 'value': best}

    race = lambda r: r['race']
    quali = lambda r: r['qualifying']
    cards = {
        'wins': {'driver': leader(tally(race, 'driver', lambda x: x['position'] == 1)), 'team': leader(tally(race, 'team', lambda x: x['position'] == 1))},
        'podiums': {'driver': leader(tally(race, 'driver', lambda x: x['position'] and x['position'] <= 3)),
                    'team': leader(tally(race, 'team', lambda x: x['position'] and x['position'] <= 3))},
        'poles': {'driver': leader(tally(quali, 'driver', lambda x: x['position'] == 1)), 'team': leader(tally(quali, 'team', lambda x: x['position'] == 1))},
    }
    # Best average finish among drivers classified in at least half the races.
    finishes: dict[str, list[int]] = defaultdict(list)
    gained: dict[str, int] = defaultdict(int)
    retirements: dict[str, int] = defaultdict(int)
    not_started: dict[str, int] = defaultdict(int)
    comeback = None
    for r in done:
        size = field_size(r['race'])
        for row in r['race']:
            if row['position']:
                finishes[row['driver']].append(row['position'])
                # A pit-lane start has grid 0: it started behind the whole field.
                grid = row['grid'] if row['grid'] else (size if row['grid'] == 0 else None)
                if grid:
                    gain = grid - row['position']
                    gained[row['driver']] += max(0, gain)
                    if comeback is None or gain > comeback['gain']:
                        comeback = {'driver': row['driver'], 'gain': gain, 'grid': grid, 'pit_lane': row['grid'] == 0,
                                    'finish': row['position'], 'round': r['round']}
            elif started(row):
                retirements[row['team']] += 1
            else:
                not_started[row['team']] += 1
    enough = {d: v for d, v in finishes.items() if len(v) >= max(1, len(done) // 2)}
    if enough:
        best = min(enough, key=lambda d: sum(enough[d]) / len(enough[d]))
        cards['average_finish'] = {'ids': [best], 'value': round(sum(enough[best]) / len(enough[best]), 2), 'races': len(enough[best])}
    if gained:
        best = max(gained, key=gained.get)
        cards['positions_gained'] = {'ids': [best], 'value': gained[best]}
    margins = [(r['round'], _margin(r['race'])) for r in done]
    margins = [(n, m) for n, m in margins if m is not None]
    if margins:
        big, small = max(margins, key=lambda x: x[1]), min(margins, key=lambda x: x[1])
        winner = lambda n: next(x for x in next(r for r in done if r['round'] == n)['race'] if x['position'] == 1)
        cards['largest_margin'] = {'round': big[0], 'value': big[1], 'ids': [winner(big[0])['driver']]}
        cards['closest_margin'] = {'round': small[0], 'value': small[1], 'ids': [winner(small[0])['driver']]}
    if comeback and comeback['gain'] > 0:
        cards['comeback'] = comeback
    if done:
        cards['retirements'] = {'by_team': dict(sorted(retirements.items(), key=lambda kv: -kv[1])),
                                'did_not_start': dict(sorted(not_started.items(), key=lambda kv: -kv[1]))}
    return cards


# ---------- per driver ----------
def driver_stats(data: dict, driver_id: str, evolution: list[dict] | None = None) -> dict:
    rounds = [r for r in data['rounds'] if r['race']]
    evolution = evolution if evolution is not None else _standings_after(data['rounds'], 'driver')
    rows = []
    for r in rounds:
        race = next((x for x in r['race'] if x['driver'] == driver_id), None)
        sprint = next((x for x in r['sprint'] if x['driver'] == driver_id), None)
        quali = next((x for x in r['qualifying'] if x['driver'] == driver_id), None)
        if race or sprint or quali:
            rows.append({'round': r['round'], 'race': race, 'sprint': sprint, 'qualifying': quali})
    classified = [x['race']['position'] for x in rows if x['race'] and x['race']['position']]
    starts = [x for x in rows if x['race'] and started(x['race'])]
    # A retirement counts as one place behind the last classified finisher, so unreliability is not hidden from the average.
    results = []
    for x in starts:
        race = next(r for r in rounds if r['round'] == x['round'])['race']
        results.append(x['race']['position'] or (sum(1 for y in race if y['position']) + 1))
    after = [next((e for e in step['table'] if e['id'] == driver_id), None) for step in evolution]
    # The team's points over the rounds this driver drove for it, so a mid-season move compares like with like.
    team_points = 0.0
    for x in rows:
        own = x['race'] or x['sprint'] or x['qualifying']
        r = next(r for r in rounds if r['round'] == x['round'])
        team_points += sum(y['points'] for y in [*r['race'], *r['sprint']] if y['team'] == own['team'])
    points = sum((x['race'] or {}).get('points', 0) + (x['sprint'] or {}).get('points', 0) for x in rows)
    return {
        'id': driver_id, 'starts': len(starts), 'points': round(points, 1),
        'wins': sum(1 for p in classified if p == 1), 'podiums': sum(1 for p in classified if p <= 3),
        'points_finishes': sum(1 for x in starts if x['race']['points'] > 0),
        'poles': sum(1 for x in rows if x['qualifying'] and x['qualifying']['position'] == 1),
        'front_rows': sum(1 for x in rows if x['qualifying'] and (x['qualifying']['position'] or 99) <= 2),
        'q3': sum(1 for x in rows if x['qualifying'] and x['qualifying']['reached'] == 3),
        'sprint_wins': sum(1 for x in rows if x['sprint'] and x['sprint']['position'] == 1),
        'sprint_points': round(sum((x['sprint'] or {}).get('points', 0) for x in rows), 1),
        'retirements': sum(1 for x in starts if not x['race']['position']),
        'did_not_start': sum(1 for x in rows if x['race'] and not started(x['race'])),
        'mechanical_retirements': sum(1 for x in starts if not x['race']['position'] and x['race'].get('cause') == 'mechanical'),
        'finish_rate': round(len(classified) / len(starts), 3) if starts else None,
        'average_result': round(sum(results) / len(results), 2) if results else None,
        'best_finish': min(classified) if classified else None,
        'average_finish': round(sum(classified) / len(classified), 2) if classified else None,
        'average_grid': round(sum(x['race']['grid'] for x in starts if x['race']['grid']) / max(1, sum(1 for x in starts if x['race']['grid'])), 2) if starts else None,
        'best_qualifying': min((x['qualifying']['position'] for x in rows if x['qualifying'] and x['qualifying']['position']), default=None),
        'team_share': round(points / team_points, 3) if team_points else None,
        'finish_counts': {str(p): classified.count(p) for p in sorted(set(classified))},
        'by_round': [{'round': x['round'], 'race_points': (x['race'] or {}).get('points', 0), 'sprint_points': (x['sprint'] or {}).get('points', 0),
                      'finish': (x['race'] or {}).get('position_text'), 'grid': (x['race'] or {}).get('grid'),
                      'qualifying': (x['qualifying'] or {}).get('position')} for x in rows],
        'position_after': [{'round': step['round'], 'position': a['position'] if a else None, 'points': a['points'] if a else 0}
                           for step, a in zip(evolution, after)],
    }


def compare(data: dict, a: str, b: str, team: str | None = None) -> dict:
    """Two drivers, weekend by weekend: qualifying ahead (both set a time), race ahead (a classified finish beats a
    retirement; two retirements count for neither), sprint ahead, and points. With `team`, only the weekends both drove
    for that team (a teammate pair after a mid-season move)."""
    tally = {'qualifying': [0, 0], 'race': [0, 0], 'sprint': [0, 0]}
    weekends = []
    for r in data['rounds']:
        if team is not None:
            def team_of(driver):
                row = next((x for x in (r['race'] or []) + (r['qualifying'] or []) if x['driver'] == driver), None)
                return row and row.get('team')
            if team_of(a) != team or team_of(b) != team:
                continue
        qa = next((x for x in r['qualifying'] if x['driver'] == a), None)
        qb = next((x for x in r['qualifying'] if x['driver'] == b), None)
        ra = next((x for x in r['race'] if x['driver'] == a), None)
        rb = next((x for x in r['race'] if x['driver'] == b), None)
        sa = next((x for x in r['sprint'] if x['driver'] == a), None)
        sb = next((x for x in r['sprint'] if x['driver'] == b), None)
        entry = {'round': r['round']}
        if qa and qb and qa['position'] and qb['position']:
            side = 0 if qa['position'] < qb['position'] else 1
            tally['qualifying'][side] += 1
            entry['qualifying'] = side
        for kind, x, y in (('race', ra, rb), ('sprint', sa, sb)):
            if x and y and (x['position'] or y['position']):
                side = 0 if (x['position'] or 99) < (y['position'] or 99) else 1
                tally[kind][side] += 1
                entry[kind] = side
                # The loser's car failed: a result the other driver did not have to earn on track.
                loser = y if side == 0 else x
                if kind == 'race' and not loser['position'] and loser.get('cause') == 'mechanical':
                    entry['race_mechanical'] = True
        if len(entry) > 1:
            weekends.append(entry)
    return {'a': a, 'b': b, 'tally': tally, 'weekends': weekends}


def teammate_pairs(data: dict) -> list[dict]:
    """Every pair of drivers who raced for the same team in at least one weekend, with their head-to-head."""
    pairs: dict[tuple, str] = {}
    for r in data['rounds']:
        by_team: dict[str, list[str]] = defaultdict(list)
        for row in r['race'] or r['qualifying']:
            if row['driver'] not in by_team[row['team']]:
                by_team[row['team']].append(row['driver'])
        for team, ids in by_team.items():
            for i in range(len(ids)):
                for j in range(i + 1, len(ids)):
                    pairs.setdefault(tuple(sorted((ids[i], ids[j]))), team)
    out = []
    for (a, b), team in pairs.items():
        result = compare(data, a, b, team)
        if result['weekends']:
            out.append({'team': team, **result})
    return sorted(out, key=lambda p: (p['team'], p['a']))


def circuit_history(source: Source, circuit_id: str, before: int) -> dict:
    """Every Grand Prix winner and pole sitter at a circuit before `before`: the 'last time here' panel for the next race."""
    wins = source.get_global(f'circuits/{circuit_id}/results/1/?limit=100')['MRData']['RaceTable']['Races']
    poles = source.get_global(f'circuits/{circuit_id}/qualifying/1/?limit=100')['MRData']['RaceTable']['Races']
    pole_by_year = {int(r['season']): r['QualifyingResults'][0] for r in poles if r.get('QualifyingResults')}
    races = []
    for r in wins:
        year = int(r['season'])
        if year >= before or not r.get('Results'):
            continue
        w, pole = r['Results'][0], pole_by_year.get(year)
        races.append({'year': year, 'winner': f"{w['Driver']['givenName']} {w['Driver']['familyName']}", 'winner_id': w['Driver']['driverId'],
                      'team': team_name(w['Constructor']['name']), 'team_id': w['Constructor']['constructorId'], 'grid': _int(w.get('grid')),
                      'pole': f"{pole['Driver']['givenName']} {pole['Driver']['familyName']}" if pole else None})
    counts: dict[str, int] = defaultdict(int)
    names = {}
    for r in races:
        counts[r['winner_id']] += 1
        names[r['winner_id']] = r['winner']
    most = max(counts.items(), key=lambda kv: kv[1]) if counts else None
    from_pole = [r for r in races if r['grid'] == 1]
    return {'circuit': circuit_id, 'races': races[-8:][::-1], 'held': len(races),
            'most_wins': {'driver': names[most[0]], 'wins': most[1]} if most else None,
            'won_from_pole': len(from_pole), 'first': races[0]['year'] if races else None}


def _median(values: list[float]) -> float:
    v = sorted(values)
    return v[len(v) // 2] if len(v) % 2 else (v[len(v) // 2 - 1] + v[len(v) // 2]) / 2


def pit_stops(source: Source, year: int, rounds: list[dict], drivers: dict) -> dict:
    """Pit lane time of every stop (entry to exit, as Jolpica publishes it): each team's median and best, and the quickest stops.
    Stops over a minute (red flags, penalties served) are left out."""
    stops = []
    now = datetime.now(timezone.utc)
    for r in rounds:
        if not r['race']:
            continue
        settled = (now - _parse(r['start'])).days >= 3   # a finished round's stops never change
        offset, total = 0, None
        while total is None or offset < total:
            data = source.get(year, f"{r['round']}/pitstops/?limit={PAGE}&offset={offset}", ttl=30 * 86400 if settled else None)['MRData']
            total = int(data.get('total') or 0)
            for race in data.get('RaceTable', {}).get('Races', []):
                for stop in race.get('PitStops', []):
                    seconds = _seconds(stop.get('duration'))
                    team = drivers.get(stop['driverId'], {}).get('team')
                    row = next((x for x in r['race'] if x['driver'] == stop['driverId']), None)
                    if seconds and seconds < 60:
                        stops.append({'driver': stop['driverId'], 'team': row['team'] if row else team, 'round': r['round'],
                                      'lap': _int(stop.get('lap')), 'seconds': round(seconds, 3)})
            offset += PAGE
            if not total:
                break
    by_team: dict[str, list[float]] = defaultdict(list)
    by_round: dict[int, list[float]] = defaultdict(list)
    for x in stops:
        by_team[x['team']].append(x['seconds'])
        by_round[x['round']].append(x['seconds'])
    # Pit lanes differ in length, so each stop is also measured against that round's median stop.
    round_median = {r: _median(v) for r, v in by_round.items()}
    relative: dict[str, list[float]] = defaultdict(list)
    for x in stops:
        relative[x['team']].append(x['seconds'] - round_median[x['round']])
    teams = sorted(({'team': t, 'stops': len(v), 'median': round(_median(v), 3), 'best': min(v),
                     'vs_field': round(_median(relative[t]), 3)} for t, v in by_team.items() if t), key=lambda e: e['vs_field'])
    return {'teams': teams, 'fastest': sorted(stops, key=lambda x: x['seconds'])[:10], 'count': len(stops)}


def weather(fetch: Callable[[str], dict], round_: dict) -> list[dict] | None:
    """Open-Meteo's daily forecast for the race weekend, once it is within its 16-day range. The same request's hourly
    forecast gives each session its own: the two hours from its start (warmest temperature, highest chance of rain, the
    wettest sky, strongest wind), stored on the session as 'weather'."""
    first, last = round_['sessions'][0]['start'][:10], round_['start'][:10]
    if (_parse(round_['start']) - datetime.now(timezone.utc)).days > 15:
        return None
    url = (f"https://api.open-meteo.com/v1/forecast?latitude={round_['lat']}&longitude={round_['lon']}"
           f"&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,weather_code"
           f"&hourly=temperature_2m,precipitation_probability,wind_speed_10m,weather_code"
           f"&timezone=auto&start_date={first}&end_date={last}")
    response = fetch(url)
    # Open-Meteo answers in the circuit's own time zone (timezone=auto): its offset lets the page show track time.
    if isinstance(response.get('utc_offset_seconds'), (int, float)):
        round_['utc_offset'] = int(response['utc_offset_seconds'])
    hourly = response.get('hourly') or {}
    offset = response.get('utc_offset_seconds')
    if hourly.get('time') and isinstance(offset, (int, float)):
        local = {t: i for i, t in enumerate(hourly['time'])}
        for session in round_['sessions']:
            start = _parse(session['start']) + timedelta(seconds=offset)
            hours = [local.get((start.replace(minute=0, second=0, microsecond=0) + timedelta(hours=h)).strftime('%Y-%m-%dT%H:%M')) for h in (0, 1)]
            hours = [i for i in hours if i is not None]
            if not hours:
                continue
            pick = lambda key: [hourly[key][i] for i in hours if hourly[key][i] is not None]
            temp, rain, wind, code = pick('temperature_2m'), pick('precipitation_probability'), pick('wind_speed_10m'), pick('weather_code')
            session['weather'] = {'temp': max(temp) if temp else None, 'rain': max(rain) if rain else None,
                                  'wind': max(wind) if wind else None, 'code': max(code) if code else None}
    d = response.get('daily') or {}
    return [{'date': day, 'max': d['temperature_2m_max'][i], 'min': d['temperature_2m_min'][i], 'rain': d['precipitation_probability_max'][i],
             'wind': d['wind_speed_10m_max'][i], 'code': d['weather_code'][i]} for i, day in enumerate(d.get('time', []))]


def tag_retirement_causes(data: dict) -> None:
    """Adds 'cause' (mechanical / incident / other) to race retirements, from the reported reason in each race's classification
    (retirement_sources). Jolpica only says "Retired" since 2024. Unknown causes stay untagged: never assumed mechanical."""
    import retirement_sources
    from performance import classify_retirement
    for r in data['rounds']:
        out = [x for x in r['race'] if not x['position'] and started(x)]
        if not out:
            continue
        report = retirement_sources.reported_retirements(data['year'], r['name'])
        for row in out:
            d = data['drivers'].get(row['driver'], {})
            reported = retirement_sources.match(report, d.get('number'), d.get('family') or '', row['laps'])
            if not reported:
                continue
            c = classify_retirement(row['status'], r['name'], d.get('code'), data['year'], reported)
            row['cause'] = ('mechanical' if c['is_mechanical'] else 'incident' if c['category'] == 'Incident / collision'
                            else 'other' if c['category'] == 'Other confirmed' else None)
            row['cause_text'] = c['cause']


def build(year: int, source: Source) -> dict:
    data = load_season(year, source)
    try:
        tag_retirement_causes(data)
    except Exception:   # reported causes are context; the season never fails for them
        pass
    summary = season_summary(data)
    try:
        summary['pit_stops'] = pit_stops(source, year, summary['rounds'], summary['drivers'])
    except Exception:   # optional extras never fail the season
        summary['pit_stops'] = None
    following = next((r for r in summary['rounds'] if r['status'] == 'next'), None)
    if following:
        try:
            summary['next_history'] = circuit_history(source, following['circuit_id'], year)
        except Exception:   # the history is a nice-to-have; the season never fails for it
            summary['next_history'] = None
        try:
            summary['next_weather'] = weather(source.fetch, following)
        except Exception:
            summary['next_weather'] = None
    return summary
