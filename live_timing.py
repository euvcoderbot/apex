"""Live session data from Formula 1's live timing feed, for the local app.

Formula 1 streams every session over SignalR: timing (positions, gaps, sectors, laps), tyres, race control, track status, weather,
the session clock, and two compressed high-rate feeds (car telemetry and car positions). Each message is either a full snapshot of a
topic or a partial update to merge into it. LiveState holds the merged state and short telemetry/position histories; a source feeds
it messages:

- LiveSource connects to the live stream through FastF1's SignalR client and also records it to disk, so the finished session can be
  loaded by FastF1 from the recording straight after the flag. Since October 2026 Formula 1 requires an F1 TV Access (or higher)
  login for its data; FastF1 stores that login's token. Without a valid stored token the client connects unauthenticated and the
  feed may be incomplete. This module never starts an interactive sign-in: the person signs in once with FastF1's CLI.
- ReplaySource feeds a finished session's archived streams (the same messages, from FastF1's local cache) through the same state
  at real or faster speed, so the live view can be used and tested outside race weekends.

This runs only in the local app (start-local). The published site has no live data: that would need an always-on server holding
someone's F1 TV account and redistributing Formula 1's live data.
"""
from __future__ import annotations

import base64
import bisect
import collections
import copy
import json
import logging
import threading
import time
import zlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

logger = logging.getLogger(__name__)

TELEMETRY_SECONDS = 300          # rolling telemetry kept per car
POSITION_SECONDS = 240           # rolling position history kept per car (for trails)
OUTLINE_STEP = 25.0              # position units (decimetres) between kept outline points
OUTLINE_JUMP = 900.0             # a larger step between samples is a gap, not a path
OUTLINE_MIN_LAP = 15000.0        # a lap is at least this long (1.5 km)
OUTLINE_CLOSE = 250.0            # back within this distance of the first point closes the loop
RACE_CONTROL_KEEP = 60
CHANNELS = {'0': 'rpm', '2': 'speed', '3': 'gear', '4': 'throttle', '5': 'brake', '45': 'drs'}
TRACK_STATUS = {'1': 'Track clear', '2': 'Yellow flag', '3': 'Flag', '4': 'Safety car', '5': 'Red flag',
                '6': 'Virtual safety car', '7': 'VSC ending'}


def decode_z(payload: str) -> Any:
    """CarData.z / Position.z payloads: base64 of raw deflate JSON."""
    return json.loads(zlib.decompress(base64.b64decode(payload), -zlib.MAX_WBITS))


def merge(target: dict, patch: dict) -> None:
    """Merge a partial update into a topic. Dicts merge recursively; F1 sends array updates as dicts keyed by index."""
    for key, value in patch.items():
        if key == '_kf':
            continue
        current = target.get(key)
        if isinstance(value, dict) and isinstance(current, dict):
            merge(current, value)
        elif isinstance(value, dict) and isinstance(current, list):
            for index_key, item in value.items():
                try:
                    index = int(index_key)
                except (TypeError, ValueError):
                    continue
                while len(current) <= index:
                    current.append({})
                if isinstance(item, dict) and isinstance(current[index], dict):
                    merge(current[index], item)
                else:
                    current[index] = copy.deepcopy(item)
        elif isinstance(value, list) and isinstance(current, list) and key == 'Messages':
            current.extend(copy.deepcopy(value))  # race control appends whole messages
        else:
            target[key] = copy.deepcopy(value)


def _utc_seconds(value: Any) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    try:
        text = str(value).replace('Z', '+00:00')
        if '.' in text:  # F1 sends 7 fractional digits; Python accepts at most 6
            head, tail = text.split('.', 1)
            digits = ''.join(ch for ch in tail if ch.isdigit())
            zone = tail[len(digits):]
            text = f'{head}.{digits[:6]}{zone}'
        stamp = datetime.fromisoformat(text)
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
        return stamp.timestamp()
    except (TypeError, ValueError):
        return None


def _seq(value: Any) -> list:
    """Topic arrays may arrive as lists or as dicts keyed by index."""
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return [value[k] for k in sorted(value, key=lambda k: int(k) if str(k).isdigit() else 0)]
    return []


def lap_seconds(value: Any) -> float | None:
    """'1:25.418' or '58.301' as seconds."""
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        minutes, _, rest = value.strip().rpartition(':')
        return round((int(minutes) * 60 if minutes else 0) + float(rest), 3)
    except ValueError:
        return None


ALIGN_POINTS = 400
ALIGN_SHIFT = 0.25   # at most a quarter lap


def _resample(lap: dict, points: int = ALIGN_POINTS) -> list[float]:
    """Speed at `points` even fractions of the lap's own distance."""
    d, v, total = lap['d'], lap['speed'], lap['distance'] or 1
    out, j = [], 0
    for i in range(points):
        target = total * i / points
        while j < len(d) - 2 and d[j + 1] < target:
            j += 1
        span = (d[j + 1] - d[j]) or 1
        f = min(1.0, max(0.0, (target - d[j]) / span))
        # Corners repeat lap to lap; 2026 straight-line speeds do not (energy deployment), so speeds above 200 km/h count as 200.
        out.append(min(200.0, (v[j] or 0) + f * ((v[j + 1] or 0) - (v[j] or 0))))
    return out


def align_lap(lap: dict, reference: dict | None) -> dict:
    """Line a lap up with the reference lap for comparison.

    The live feed's car-data clock drifts by seconds against its timing messages, so a lap cut by time starts at a
    slightly different point of the circuit each time. The lap is rotated (wrapping its end to its start) by the shift
    that best matches the reference lap's speed trace, then scaled to the reference length. `x` is the aligned
    distance; `t` restarts at the aligned start; `shift` is the rotation applied, as a fraction of the lap."""
    if lap.get('spatial'):
        out = {k: v for k, v in lap.items() if k != 'd'}
        out.update({'x': lap['d'], 'reference': lap['distance'], 'shift': 0.0, 'aligned_by': 'position'})
        return out
    length = (reference or lap)['distance'] or lap['distance'] or 1
    count, total, duration = len(lap['d']), lap['distance'] or 1, lap['t'][-1] if lap['t'] else 0
    shift = 0
    if reference is not None and reference is not lap and count > 20 and len(reference['d']) > 20:
        a, r = _resample(lap), _resample(reference)
        limit = int(ALIGN_POINTS * ALIGN_SHIFT)
        shift = min(range(-limit, limit + 1), key=lambda k: sum((a[(i + k) % ALIGN_POINTS] - r[i]) ** 2 for i in range(0, ALIGN_POINTS, 2)))
    offset = total * shift / ALIGN_POINTS
    order = sorted(range(count), key=lambda i: (lap['d'][i] - offset) % total)
    t_offset = 0.0
    if shift:
        first = order[0]
        t_offset = lap['t'][first]
    out = {k: v for k, v in lap.items() if k not in ('t', 'd', 'speed', 'throttle', 'brake', 'gear')}
    out['t'] = [round((lap['t'][i] - t_offset) % (duration or 1), 3) for i in order]
    out['x'] = [round((lap['d'][i] - offset) % total / total * length, 1) for i in order]
    for name in ('speed', 'throttle', 'brake', 'gear'):
        out[name] = [lap[name][i] for i in order]
    out.update({'reference': round(length, 1), 'shift': round(shift / ALIGN_POINTS, 3),
                'reference_lap': {'driver': reference.get('driver'), 'lap': reference.get('lap')} if reference else None})
    return out


def _clock_shift(stamps: list[float | None], received: float | None) -> float:
    """Samples are timed on the feed's message clock, as FastF1 does: the batch's newest sample is placed at the time the
    message was sent and the others keep their spacing. The cars' own UTC stamps drift by seconds against the timing
    messages, which would put lap boundaries at different points of the circuit."""
    known = [t for t in stamps if t is not None]
    return received - max(known) if received is not None and known else 0.0


def _median_point(points) -> list[float] | None:
    if len(points) < 5:
        return None
    xs, ys = sorted(p[0] for p in points), sorted(p[1] for p in points)
    return [round(xs[len(xs) // 2], 1), round(ys[len(ys) // 2], 1)]


def _session_year(info: dict) -> int | None:
    path = str(info.get('Path') or '')
    return int(path[:4]) if path[:4].isdigit() else None


class LiveState:
    """Merged live state plus rolling telemetry and positions. Thread-safe."""

    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.reset()

    def reset(self) -> None:
        with getattr(self, 'lock', threading.RLock()):
            self.topics: dict[str, Any] = {}
            self.telemetry: dict[str, collections.deque] = collections.defaultdict(lambda: collections.deque(maxlen=TELEMETRY_SECONDS * 5))
            self.positions: dict[str, collections.deque] = collections.defaultdict(lambda: collections.deque(maxlen=POSITION_SECONDS * 5))
            # The track outline is learned from one car's path: every car's on-track points are kept (thinned to OUTLINE_STEP apart)
            # until one of them comes back to where it started after a full lap; that loop is the outline.
            self.paths: dict[str, list[tuple[float, float]]] = collections.defaultdict(list)
            self.path_lengths: dict[str, float] = collections.defaultdict(float)
            self.outline_loop: list[tuple[float, float]] | None = None
            self.data_time: float | None = None       # feed time of the newest message (UTC seconds)
            # Completed laps, cut from each car's telemetry between consecutive lap-count changes (see _check_laps).
            self.laps: dict[str, dict[int, dict]] = collections.defaultdict(dict)
            self.lap_counts: dict[str, int] = {}
            self.lap_marks: dict[str, float] = {}
            self.lap_pit: dict[str, bool] = collections.defaultdict(bool)
            self.lap_waiting: dict[str, int] = {}
            self.lap_pending: list[dict] = []   # laps waiting for their last telemetry to arrive
            self.line_points: collections.deque = collections.deque(maxlen=400)   # car positions at lap-count changes
            self.sector_points: list[collections.deque] = [collections.deque(maxlen=400), collections.deque(maxlen=400)]  # at sector 1 and 2 times
            self.version = 0
            self.messages = 0

    # ---------- applying messages ----------
    def apply(self, topic: str, data: Any, stamp: Any = None) -> None:
        with self.lock:
            self.messages += 1
            moment = _utc_seconds(stamp) if stamp else None
            if topic.endswith('.z'):
                if isinstance(data, str):
                    try:
                        data = decode_z(data)
                    except (ValueError, zlib.error):
                        return
                topic = topic[:-2]
            if topic == 'CarData':
                self._car_data(data, moment)
            elif topic == 'Position':
                self._positions(data, moment)
            elif isinstance(data, dict):
                if topic == 'SessionInfo':
                    old = (self.topics.get('SessionInfo') or {}).get('Path')
                    if old and data.get('Path') and data.get('Path') != old:
                        self.reset()   # the feed moved on to the next session; never mix two sessions' laps
                        self.messages = 1
                existing = self.topics.get(topic)
                if isinstance(existing, dict) and not data.get('_kf'):
                    merge(existing, data)
                else:
                    self.topics[topic] = copy.deepcopy(data)
                if topic == 'TimingData':
                    self._check_laps(data, moment)
            elif data is not None:
                self.topics[topic] = data
            if moment and (self.data_time is None or moment > self.data_time):
                self.data_time = moment
            self.version += 1

    def _car_data(self, data: Any, received: float | None = None) -> None:
        entries = (data or {}).get('Entries', [])
        shift = _clock_shift([_utc_seconds(e.get('Utc')) for e in entries], received)
        for entry in entries:
            moment = _utc_seconds(entry.get('Utc'))
            moment = moment + shift if moment is not None else None
            if moment is None:
                continue
            for number, car in (entry.get('Cars') or {}).items():
                channels = car.get('Channels') or {}
                sample = {'t': moment}
                for key, name in CHANNELS.items():
                    if key in channels:
                        sample[name] = channels[key]
                # As FastF1 reads them: 104 marks a pedal value that is unavailable; brake is on or off.
                if isinstance(sample.get('throttle'), (int, float)) and sample['throttle'] > 100:
                    sample['throttle'] = None
                if 'brake' in sample:
                    sample['brake'] = None if sample['brake'] == 104 else (100 if sample['brake'] else 0)
                self.telemetry[str(number)].append(sample)
            if self.data_time is None or moment > self.data_time:
                self.data_time = moment
        if self.lap_pending:
            self._flush_laps()

    def _positions(self, data: Any, received: float | None = None) -> None:
        frames = (data or {}).get('Position', [])
        shift = _clock_shift([_utc_seconds(f.get('Timestamp')) for f in frames], received)
        for frame in frames:
            moment = _utc_seconds(frame.get('Timestamp'))
            moment = moment + shift if moment is not None else None
            if moment is None:
                continue
            for number, car in (frame.get('Entries') or {}).items():
                x, y = car.get('X'), car.get('Y')
                if x is None or y is None:
                    continue
                self.positions[str(number)].append((moment, float(x), float(y), car.get('Status')))
                if self.outline_loop is None and car.get('Status') == 'OnTrack' and (x or y):
                    self._learn_outline(str(number), float(x), float(y))
            if self.data_time is None or moment > self.data_time:
                self.data_time = moment

    # ---------- completed laps ----------
    def _check_laps(self, patch: dict, moment: float | None = None) -> None:
        """A driver's lap count going from k-1 to k completes lap k. The lap is the car's telemetry between this change and
        the previous one: both marks carry the same feed delay, so it cancels out. Without a previous mark (the first lap
        seen) the lap time sets the start instead."""
        # The boundary is the timing message's own time when there is one: every driver's boundary then carries the same
        # feed delay, so laps line up with each other. Car telemetry can arrive after the timing message, so the lap is cut
        # once samples past its end are in (see _flush_laps).
        lines = (patch or {}).get('Lines') or {}
        timing = (self.topics.get('TimingData') or {}).get('Lines') or {}
        for number, change in lines.items():
            if not isinstance(change, dict):
                continue
            number = str(number)
            sectors = change.get('Sectors')
            if moment is not None and isinstance(sectors, (dict, list)):
                items = sectors.items() if isinstance(sectors, dict) else enumerate(sectors)
                for index, sector in items:
                    if str(index) in ('0', '1') and isinstance(sector, dict) and sector.get('Value'):
                        near = self._position_at(number, moment)
                        if near:
                            self.sector_points[int(index)].append(near)
            if change.get('InPit') is True or change.get('PitOut') is True:
                self.lap_pit[number] = True
            new_time = (change.get('LastLapTime') or {}).get('Value') if isinstance(change.get('LastLapTime'), dict) else None
            waiting = self.lap_waiting.pop(number, None) if new_time and 'NumberOfLaps' not in change else None
            if waiting is not None:  # the lap time came after the lap count
                for lap in [self.laps.get(number, {}).get(waiting), *[p for p in self.lap_pending if p['number'] == number and p['lap'] == waiting]]:
                    if lap:
                        lap.update({'time': new_time, 'seconds': lap_seconds(new_time)})
            count = change.get('NumberOfLaps')
            if not isinstance(count, int):
                continue
            previous = self.lap_counts.get(number)
            self.lap_counts[number] = count
            mark = moment if moment is not None else self._newest_sample(number)
            near = self._position_at(number, mark) if mark is not None else None
            if near:
                self.line_points.append(near)
            if previous is None or count != previous + 1 or mark is None:
                if mark is not None:
                    self.lap_marks[number] = mark
                self.lap_pit[number] = False
                continue
            line = timing.get(number) or {}
            seconds = lap_seconds(new_time)
            start = self.lap_marks.get(number)
            if start is None and seconds:
                start = mark - seconds
            if start is not None and mark - start > 20:
                self.lap_pending.append({'number': number, 'lap': count, 'start': start, 'end': mark, 'time': new_time, 'seconds': seconds,
                                         'pit': self.lap_pit[number] or bool(line.get('InPit')) or bool(line.get('PitOut'))})
                if not new_time:
                    self.lap_waiting[number] = count
                self._flush_laps()
            self.lap_marks[number] = mark
            self.lap_pit[number] = bool(line.get('InPit'))

    def _flush_laps(self, force: bool = False) -> None:
        keep = []
        for pending in self.lap_pending:
            newest = self._newest_sample(pending['number'])
            if not force and (newest is None or newest < pending['end'] + 1.0):
                keep.append(pending)
                continue
            start, end = self._snap(pending['number'], pending['start']), self._snap(pending['number'], pending['end'])
            lap = self._cut_lap(pending['number'], start, end)
            if lap:
                lap.update({k: pending[k] for k in ('lap', 'time', 'seconds', 'pit')})
                self.laps[pending['number']][pending['lap']] = lap
        self.lap_pending = keep

    def _reference_lap(self) -> dict | None:
        timed = [l for laps in self.laps.values() for l in laps.values() if l.get('seconds') and not l.get('pit')]
        return min(timed, key=lambda l: l['seconds']) if timed else None

    def _position_at(self, number: str, moment: float) -> tuple[float, float] | None:
        history = self.positions.get(number)
        if not history:
            return None
        best = min(history, key=lambda p: abs(p[0] - moment))
        return (best[1], best[2]) if abs(best[0] - moment) < 3 and (best[1] or best[2]) else None

    def _snap(self, number: str, moment: float) -> float:
        """Move a lap boundary to when the car actually passed the timing line. The line is where cars are when their lap
        count changes (the median of those positions, so a few late messages do not move it). Timing messages reach the
        feed with a delay that differs between drivers; the car's own position does not."""
        if len(self.line_points) < 5:
            return moment
        xs, ys = sorted(p[0] for p in self.line_points), sorted(p[1] for p in self.line_points)
        lx, ly = xs[len(xs) // 2], ys[len(ys) // 2]
        track = [p for p in self.positions.get(number, ()) if abs(p[0] - moment) <= 12 and (p[1] or p[2])]
        best, best_distance = None, None
        for a, b in zip(track, track[1:]):
            dx, dy = b[1] - a[1], b[2] - a[2]
            span = dx * dx + dy * dy
            f = 0.0 if not span else max(0.0, min(1.0, ((lx - a[1]) * dx + (ly - a[2]) * dy) / span))
            distance = ((a[1] + f * dx - lx) ** 2 + (a[2] + f * dy - ly) ** 2) ** .5
            if best_distance is None or distance < best_distance:
                best, best_distance = a[0] + f * (b[0] - a[0]), distance
        return best if best is not None and best_distance < 600 else moment   # within 60 m of the line

    def _newest_sample(self, number: str) -> float | None:
        samples = self.telemetry.get(number)
        return samples[-1]['t'] if samples else None

    def _cut_lap(self, number: str, start: float, end: float) -> dict | None:
        samples = [s for s in self.telemetry.get(number, ()) if start <= s['t'] <= end]
        if len(samples) < 20:
            return None
        distance, out = 0.0, {'t': [], 'd': [], 'speed': [], 'throttle': [], 'brake': [], 'gear': []}
        for index, sample in enumerate(samples):
            if index:
                previous = samples[index - 1]
                distance += ((previous.get('speed') or 0) + (sample.get('speed') or 0)) / 2 / 3.6 * (sample['t'] - previous['t'])
            out['t'].append(round(sample['t'] - samples[0]['t'], 3))
            out['d'].append(round(distance, 1))
            for name in ('speed', 'throttle', 'brake', 'gear'):
                out[name].append(sample.get(name))
        out['distance'] = round(distance, 1)
        spatial = self._track_distances(number, [s['t'] for s in samples])
        if spatial:
            out['d'], out['distance'], out['spatial'] = spatial[0], spatial[1], True
        return out

    # ---------- distance along the track, from car positions (as the main site lines laps up by GPS) ----------
    def _geometry(self) -> dict | None:
        """The learned outline as a polyline measured in metres from the timing line."""
        line = _median_point(self.line_points)
        if not self.outline_loop or not line:
            return None
        key = (id(self.outline_loop), tuple(line))
        if getattr(self, '_geometry_cache', None) and self._geometry_cache['key'] == key:
            return self._geometry_cache
        points = list(self.outline_loop) + [self.outline_loop[0]]
        cumulative = [0.0]
        for (x0, y0), (x1, y1) in zip(points, points[1:]):
            cumulative.append(cumulative[-1] + ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** .5)
        geometry = {'key': key, 'points': points, 'cum': cumulative, 'length': cumulative[-1]}
        geometry['origin'] = self._project(geometry, line[0], line[1])[0]
        self._geometry_cache = geometry
        return geometry

    @staticmethod
    def _project(geometry: dict, x: float, y: float, hint: int | None = None, window: int = 25) -> tuple[float, int, float]:
        """Nearest point of the outline: (distance along it, segment index, distance from it). With a hint only the
        segments near it are searched, since consecutive samples move forward a little."""
        points, cumulative, count = geometry['points'], geometry['cum'], len(geometry['points']) - 1
        indices = range(count) if hint is None else ((hint + k) % count for k in range(-window // 3, window))
        best = (0.0, 0, float('inf'))
        for i in indices:
            (x0, y0), (x1, y1) = points[i], points[i + 1]
            dx, dy = x1 - x0, y1 - y0
            span = dx * dx + dy * dy
            f = 0.0 if not span else max(0.0, min(1.0, ((x - x0) * dx + (y - y0) * dy) / span))
            gap = ((x0 + f * dx - x) ** 2 + (y0 + f * dy - y) ** 2) ** .5
            if gap < best[2]:
                best = (cumulative[i] + f * (cumulative[i + 1] - cumulative[i]), i, gap)
        return best

    def _track_distances(self, number: str, times: list[float]) -> tuple[list[float], float] | None:
        """Distance from the timing line in metres for each sample time, from the car's position at that moment
        projected onto the outline. None when the outline or line is not known yet, or positions are missing."""
        geometry = self._geometry()
        if not geometry or not times:
            return None
        track = [p for p in self.positions.get(number, ()) if times[0] - 2 <= p[0] <= times[-1] + 2 and (p[1] or p[2])]
        if len(track) < 10:
            return None
        stamps = [p[0] for p in track]
        length, origin, out, hint = geometry['length'], geometry['origin'], [], None
        for t in times:
            i = min(max(bisect.bisect_left(stamps, t), 1), len(track) - 1)
            a, b = track[i - 1], track[i]
            f = 0.0 if b[0] == a[0] else max(0.0, min(1.0, (t - a[0]) / (b[0] - a[0])))
            along, hint, gap = self._project(geometry, a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2]), hint)
            if gap > 600:   # off the outline (pit lane): fall back to a full search next time
                hint = None
            out.append((along - origin) % length)
        # Laps start a moment either side of the line: unwrap, so distance runs on from about 0 to one lap.
        if out[0] > length / 2:
            out[0] -= length
        for k in range(1, len(out)):
            while out[k] < out[k - 1] - length / 2:
                out[k] += length
            while out[k] > out[k - 1] + length / 2:
                out[k] -= length
        return [round(v / 10, 1) for v in out], round(length / 10, 1)

    def lap_list(self) -> dict[str, list[dict]]:
        """Completed laps per driver, without samples. `fastest` marks each driver's quickest lap that did not touch the pit lane."""
        with self.lock:
            result = {}
            for number, laps in self.laps.items():
                timed = [l for l in laps.values() if l.get('seconds') and not l.get('pit')]
                best = min(timed, key=lambda l: l['seconds'])['lap'] if timed else None
                result[number] = [{'lap': l['lap'], 'time': l.get('time'), 'seconds': l.get('seconds'), 'pit': l.get('pit'),
                                   'distance': l.get('distance'), 'fastest': l['lap'] == best} for l in sorted(laps.values(), key=lambda l: l['lap'])]
            return result

    def lap_trace(self, number: str, lap: str | int) -> dict | None:
        """One completed lap with samples; `lap` is a lap number, 'fastest' or 'last'."""
        with self.lock:
            laps = self.laps.get(str(number)) or {}
            if not laps:
                return None
            if lap == 'fastest':
                timed = [l for l in laps.values() if l.get('seconds') and not l.get('pit')]
                chosen = min(timed, key=lambda l: l['seconds']) if timed else None
            elif lap == 'last':
                chosen = laps[max(laps)]
            else:
                try:
                    chosen = laps.get(int(lap))
                except (TypeError, ValueError):
                    chosen = None
            if not chosen:
                return None
            reference = self._reference_lap()
            return {'driver': str(number), **align_lap(chosen, reference)}


    def _learn_outline(self, number: str, x: float, y: float) -> None:
        path = self.paths[number]
        if path:
            px, py = path[-1]
            step = ((x - px) ** 2 + (y - py) ** 2) ** .5
            if step < OUTLINE_STEP:
                return
            if step > OUTLINE_JUMP:  # a gap in the feed (or the pit lane exit): start this car's path again
                path.clear(); self.path_lengths[number] = 0.0
            else:
                self.path_lengths[number] += step
        path.append((x, y))
        fx, fy = path[0]
        if self.path_lengths[number] > OUTLINE_MIN_LAP and len(path) > 60 and ((x - fx) ** 2 + (y - fy) ** 2) ** .5 < OUTLINE_CLOSE:
            self.outline_loop = list(path)
            self.paths.clear()

    # ---------- views ----------
    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            t = self.topics
            info, status = t.get('SessionInfo') or {}, t.get('SessionStatus') or {}
            timing = (t.get('TimingData') or {}).get('Lines') or {}
            app = (t.get('TimingAppData') or {}).get('Lines') or {}
            stats = (t.get('TimingStats') or {}).get('Lines') or {}
            drivers_meta = t.get('DriverList') or {}
            numbers = set(timing) | {k for k in drivers_meta if isinstance(drivers_meta.get(k), dict)}
            rows = []
            for number in numbers:
                meta = drivers_meta.get(number) or {}
                line = timing.get(number) or {}
                stints = _seq((app.get(number) or {}).get('Stints'))
                stint = stints[-1] if stints else {}
                sectors = []
                for sector in _seq(line.get('Sectors'))[:3]:
                    sectors.append({'time': sector.get('Value') or None, 'personal': bool(sector.get('PersonalFastest')),
                                    'overall': bool(sector.get('OverallFastest'))})
                last, best = line.get('LastLapTime') or {}, line.get('BestLapTime') or {}
                interval = line.get('IntervalToPositionAhead')
                position = line.get('Position') or meta.get('Line')
                speeds = (stats.get(number) or {}).get('BestSpeeds') or {}
                rows.append({
                    'number': str(number), 'code': meta.get('Tla') or str(number), 'name': meta.get('FullName') or meta.get('BroadcastName'),
                    'team': meta.get('TeamName'), 'color': ('#' + str(meta.get('TeamColour')).lstrip('#')) if meta.get('TeamColour') else None,
                    'position': int(position) if str(position or '').isdigit() else None,
                    'gap': line.get('GapToLeader') if isinstance(line.get('GapToLeader'), str) else (line.get('TimeDiffToFastest') or None),
                    'interval': interval.get('Value') if isinstance(interval, dict) else interval if isinstance(interval, str) else (line.get('TimeDiffToPositionAhead') or None),
                    'last': {'time': last.get('Value') or None, 'personal': bool(last.get('PersonalFastest')), 'overall': bool(last.get('OverallFastest'))},
                    'best': best.get('Value') or None,
                    'sectors': sectors,
                    'laps': line.get('NumberOfLaps'),
                    'pits': line.get('NumberOfPitStops'),
                    'in_pit': bool(line.get('InPit')), 'pit_out': bool(line.get('PitOut')),
                    'retired': bool(line.get('Retired')), 'stopped': bool(line.get('Stopped')), 'knocked_out': bool(line.get('KnockedOut')),
                    'stint': {'compound': stint.get('Compound'), 'new': str(stint.get('New')).lower() == 'true', 'laps': stint.get('TotalLaps')} if stint else None,
                    'top_speed': (speeds.get('ST') or {}).get('Value') if isinstance(speeds.get('ST'), dict) else None,
                })
            rows.sort(key=lambda r: (r['position'] is None, r['position'] or 99, r['number']))
            race_control = []
            for message in _seq((t.get('RaceControlMessages') or {}).get('Messages'))[-RACE_CONTROL_KEEP:]:
                if isinstance(message, dict) and message.get('Message'):
                    race_control.append({'utc': message.get('Utc'), 'lap': message.get('Lap'), 'category': message.get('Category'),
                                         'flag': message.get('Flag'), 'message': message.get('Message')})
            race_control.reverse()
            track = t.get('TrackStatus') or {}
            clock, laps, weather = t.get('ExtrapolatedClock') or {}, t.get('LapCount') or {}, t.get('WeatherData') or {}
            positions = {}
            for number, history in self.positions.items():
                if history:
                    moment, x, y, state = history[-1]
                    positions[number] = {'x': x, 'y': y, 'status': state}
            meeting = info.get('Meeting') or {}
            return {
                'version': self.version, 'messages': self.messages,
                'data_time': self.data_time,
                'session': {'name': info.get('Name'), 'type': info.get('Type'), 'meeting': meeting.get('Name') or meeting.get('OfficialName'),
                            'circuit': (meeting.get('Circuit') or {}).get('ShortName'), 'path': info.get('Path'),
                            'circuit_key': (meeting.get('Circuit') or {}).get('Key'), 'year': _session_year(info),
                            'status': status.get('Status') or (info.get('ArchiveStatus') or {}).get('Status')},
                'track_status': {'code': str(track.get('Status')) if track.get('Status') is not None else None,
                                 'label': TRACK_STATUS.get(str(track.get('Status')), track.get('Message'))},
                'clock': {'remaining': clock.get('Remaining'), 'extrapolating': bool(clock.get('Extrapolating')), 'utc': clock.get('Utc')},
                'lap': {'current': laps.get('CurrentLap'), 'total': laps.get('TotalLaps')},
                'weather': {k: weather.get(v) for k, v in (('air', 'AirTemp'), ('track', 'TrackTemp'), ('humidity', 'Humidity'),
                                                          ('rain', 'Rainfall'), ('wind_speed', 'WindSpeed'), ('wind_direction', 'WindDirection'))},
                'drivers': rows,
                'race_control': race_control,
                'positions': positions,
                'outline': 'complete' if self.outline_loop else 'learning',
            }

    def outline(self) -> dict[str, Any]:
        """The learned track outline: the closed loop once a car has lapped, else the longest partial path so far."""
        with self.lock:
            points = self.outline_loop or max(self.paths.values(), key=len, default=[])
            return {'complete': self.outline_loop is not None, 'points': [[round(x, 1), round(y, 1)] for x, y in points],
                    # Where the timing line and the two sector boundaries are (medians of car positions when those times arrived).
                    'line': _median_point(self.line_points), 'sectors': [_median_point(p) for p in self.sector_points]}

    def telemetry_for(self, numbers: list[str], seconds: float = 60) -> dict[str, list[dict]]:
        with self.lock:
            out = {}
            for number in numbers:
                history = self.telemetry.get(str(number))
                if not history:
                    out[str(number)] = []
                    continue
                cutoff = history[-1]['t'] - seconds
                times = [s['t'] for s in history]
                out[str(number)] = list(history)[bisect.bisect_left(times, cutoff):]
            return out

    def current_laps(self, numbers: list[str]) -> dict[str, Any]:
        """The lap each chosen car is on, from the timing line to now, measured along the track (as completed laps are),
        plus the track length for a full-lap scale. Falls back to integrated speed before the circuit is learned."""
        with self.lock:
            geometry = self._geometry()
            reference = self._reference_lap()
            length = round(geometry['length'] / 10, 1) if geometry else (reference or {}).get('distance')
            out = {'length': length, 'laps': {}}
            for number in numbers:
                number = str(number)
                history = self.telemetry.get(number)
                start = self.lap_marks.get(number)
                if not history or start is None:
                    out['laps'][number] = None
                    continue
                samples = [sample for sample in history if sample['t'] >= start - 1]
                if len(samples) < 2:
                    out['laps'][number] = None
                    continue
                spatial = self._track_distances(number, [sample['t'] for sample in samples])
                if spatial:
                    xs = spatial[0]
                else:
                    xs, total = [], 0.0
                    for i, sample in enumerate(samples):
                        if i:
                            total += ((samples[i - 1].get('speed') or 0) + (sample.get('speed') or 0)) / 2 / 3.6 * (sample['t'] - samples[i - 1]['t'])
                        xs.append(round(total, 1))
                out['laps'][number] = {'lap': (self.lap_counts.get(number) or 0) + 1, 'x': xs,
                                       **{name: [sample.get(name) for sample in samples] for name in ('speed', 'throttle', 'brake', 'gear')}}
            return out

    def missing_laps(self) -> bool:
        """Whether any car has completed laps that were not captured (from before connecting, or a gap in the feed)."""
        with self.lock:
            for number, count in self.lap_counts.items():
                have = self.laps.get(number) or {}
                if any(lap not in have for lap in range(2, count + 1)):
                    return True
            return False


# ---------- sources ----------
class Source(threading.Thread):
    kind = 'source'

    def __init__(self, state: LiveState) -> None:
        super().__init__(daemon=True, name=f'live-{self.kind}')
        self.state = state
        self.stop_event = threading.Event()
        self.error: str | None = None
        self.started_at = time.time()
        self.detail: dict[str, Any] = {}

    def stop(self) -> None:
        self.stop_event.set()

    def describe(self) -> dict[str, Any]:
        return {'kind': self.kind, 'running': self.is_alive() and not self.stop_event.is_set(), 'error': self.error,
                'started_at': self.started_at, **self.detail}


def stored_token_status() -> dict[str, Any]:
    """The FastF1 F1 TV login stored on this machine, without signing in."""
    try:
        from fastf1.internals.f1account import token_manager
    except Exception:  # FastF1 older than 3.9
        return {'available': False, 'reason': 'FastF1 3.9 or newer is required for F1 TV sign-in.'}
    try:
        token = token_manager.get_stored()
    except Exception as exc:
        return {'available': False, 'reason': f'Could not read the stored sign-in: {exc}'}
    if token is None:
        return {'available': False, 'reason': 'Not signed in.'}
    claims = getattr(token, 'claims', {}) or {}
    return {'available': bool(token.is_valid()), 'expires_at': getattr(token, 'expires_at', None),
            'subscription': claims.get('SubscribedProduct'), 'status': claims.get('SubscriptionStatus'),
            'reason': None if token.is_valid() else 'The stored sign-in has expired.'}


class LiveSource(Source):
    """The live SignalR stream, through FastF1's client (which also records the session to a file)."""
    kind = 'live'

    def __init__(self, state: LiveState, recording_dir: Path) -> None:
        super().__init__(state)
        recording_dir.mkdir(parents=True, exist_ok=True)
        self.recording = recording_dir / f"live-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}.txt"
        self.auth = stored_token_status()
        self.detail = {'recording': str(self.recording), 'authenticated': self.auth.get('available', False), 'auth': self.auth}
        self.client = None

    def run(self) -> None:
        try:
            from fastf1.livetiming.client import SignalRClient
            from signalrcore.messages.completion_message import CompletionMessage
        except Exception as exc:
            self.error = f'FastF1 live client unavailable: {exc}'
            return
        state, authenticated = self.state, bool(self.auth.get('available'))

        class Client(SignalRClient):
            def _access_token_factory(self):  # never prompt; use the stored token or connect without one
                if not authenticated:
                    return None
                from fastf1.internals.f1account import token_manager
                return lambda: token_manager.get_stored().value

            def _on_message(self, msg):
                super()._on_message(msg)
                try:
                    if isinstance(msg, CompletionMessage):
                        for topic, data in (msg.result or {}).items():
                            state.apply(topic, data, None)
                    elif isinstance(msg, list) and len(msg) >= 2:
                        state.apply(str(msg[0]), msg[1], msg[2] if len(msg) > 2 else None)
                except Exception:
                    logger.exception('Could not apply a live timing message')

        try:
            self.client = Client(str(self.recording), timeout=0, no_auth=not authenticated)
            self.client._run()
            while not self.stop_event.wait(1):
                pass
        except Exception as exc:
            self.error = f'Live connection failed: {exc}'
            logger.warning('Live timing connection failed: %s', exc)
        finally:
            try:
                if self.client and self.client._connection:
                    self.client._exit()
            except Exception:
                pass


def cached_stream_reader(cache_dir: str | None) -> Callable[[str, str], list[str] | None]:
    """Read archived `.jsonStream` files from FastF1's HTTP cache file, read-only and never over the network.
    This deliberately leaves FastF1's own global cache settings alone, so session analysis keeps working normally."""
    import requests
    import requests_cache
    if not cache_dir:
        raise RuntimeError('No FastF1 cache folder is configured.')
    cache = requests_cache.CachedSession(str(Path(cache_dir) / 'fastf1_http_cache'), backend='sqlite').cache

    def read(path: str, topic: str) -> list[str] | None:
        url = 'https://livetiming.formula1.com' + path + topic + '.jsonStream'
        response = cache.get_response(cache.create_key(requests.Request('GET', url).prepare()))
        if response is None or response.status_code != 200:
            return None
        return response.content.decode('utf-8-sig').splitlines()
    return read


def archive_stream_reader() -> Callable[[str, str], list[str] | None]:
    """Read a session's `.jsonStream` files from Formula 1's archive over the network, signed in with the F1 TV token
    FastF1 stores on this PC (FastF1's own authenticating transport, mounted only for the livetiming host). F1 publishes
    these files while a session runs, so they also hold what happened before the live connection started."""
    import requests
    from fastf1.internals.f1account import token_manager
    from fastf1.internals.f1account.transport import LIVETIMING_URL, LivetimingAuthAdapter
    session = requests.Session()
    session.mount(LIVETIMING_URL, LivetimingAuthAdapter(token_manager))

    def read(path: str, topic: str) -> list[str] | None:
        response = session.get('https://livetiming.formula1.com' + path + topic + '.jsonStream', timeout=90)
        if response.status_code != 200:
            return None
        return response.content.decode('utf-8-sig').splitlines()
    return read


def archive_sessions(year: int) -> list[dict[str, Any]]:
    """The season's sessions Formula 1 has published, from its archive index (needs the F1 TV sign-in)."""
    import requests
    from fastf1.internals.f1account import token_manager
    from fastf1.internals.f1account.transport import LIVETIMING_URL, LivetimingAuthAdapter
    session = requests.Session()
    session.mount(LIVETIMING_URL, LivetimingAuthAdapter(token_manager))
    response = session.get(f'https://livetiming.formula1.com/static/{year}/Index.json', timeout=30)
    response.raise_for_status()
    index = json.loads(response.content.decode('utf-8-sig'))
    found = []
    for meeting in index.get('Meetings') or []:
        for item in meeting.get('Sessions') or []:
            path = item.get('Path')
            if path:
                found.append({'path': '/static/' + path, 'year': year, 'event': meeting.get('Name'), 'session': item.get('Name'),
                              'date': str(item.get('StartDate') or '')[:10], 'archive': True})
    return found


class ReplaySource(Source):
    """A finished session's archived streams, replayed through the same state at `speed` times real time."""
    kind = 'replay'
    TOPICS = {'session_info': 'SessionInfo', 'session_status': 'SessionStatus', 'driver_list': 'DriverList',
              'timing_data': 'TimingData', 'timing_app_data': 'TimingAppData', 'timing_stats': 'TimingStats',
              'track_status': 'TrackStatus', 'race_control_messages': 'RaceControlMessages', 'weather_data': 'WeatherData',
              'lap_count': 'LapCount', 'extrapolated_clock': 'ExtrapolatedClock', 'car_data': 'CarData.z', 'position': 'Position.z'}

    def __init__(self, state: LiveState, path: str, speed: float = 1.0, start: float = 0.0,
                 cache_dir: str | None = None, fetch: Callable | None = None) -> None:
        super().__init__(state)
        self.path, self.speed, self.start_at = path, max(.1, float(speed)), max(0.0, float(start))
        self.cache_dir, self.fetch = cache_dir, fetch
        self.base: float | None = None
        self.detail = {'path': path, 'speed': self.speed, 'position': 0.0, 'duration': None, 'topics': []}

    def _load(self, topics: tuple[str, ...] | None = None) -> list[tuple[float, str, Any]]:
        fetch = self.fetch or cached_stream_reader(self.cache_dir)
        events, found = [], []
        for topic in topics or tuple(self.TOPICS.values()):
            try:
                lines = fetch(self.path, topic)
            except Exception:
                lines = None
            if not lines:
                continue
            found.append(topic)
            for line in lines:
                stamp, body = line[:12], line[12:].strip()
                if not body:
                    continue
                if body.startswith('"'):  # compressed telemetry/position: "base64"
                    events.append((_offset(stamp), topic, body.strip('"')))
                    continue
                try:
                    events.append((_offset(stamp), topic, json.loads(body)))
                except ValueError:
                    continue
        events.sort(key=lambda e: e[0])
        self.detail['topics'] = found
        self.base = self._utc_base(events)
        return events

    @staticmethod
    def _utc_base(events: list[tuple[float, str, Any]]) -> float | None:
        """UTC of the archive's zero offset, so replayed messages carry real times as live ones do: the median of
        (newest car-data UTC in a message - that message's offset) over a sample of car-data messages."""
        deltas = []
        car = [e for e in events if e[1] == 'CarData.z']
        for offset, _, payload in car[:: max(1, len(car) // 60)]:
            try:
                entries = decode_z(payload).get('Entries') or []
            except Exception:
                continue
            times = [t for t in (_utc_seconds(e.get('Utc')) for e in entries) if t]
            if times:
                deltas.append(max(times) - offset)
        deltas.sort()
        return deltas[len(deltas) // 2] if deltas else None

    def run(self) -> None:
        try:
            events = self._load()
        except Exception as exc:
            self.error = f'Replay unavailable: {exc}'
            return
        if not events:
            self.error = 'This session is not in the local cache. Load it once in Session analysis, then replay it.'
            return
        self.detail['duration'] = events[-1][0]
        wall0, feed0 = time.monotonic(), self.start_at
        for offset, topic, data in events:
            if self.stop_event.is_set():
                return
            if offset < self.start_at:  # fast-forward: apply without waiting
                self.state.apply(topic, data, self.base + offset if self.base else None)
                continue
            wait = (offset - feed0) / self.speed - (time.monotonic() - wall0)
            if wait > 0 and self.stop_event.wait(wait):
                return
            self.state.apply(topic, data, self.base + offset if self.base else None)
            self.detail['position'] = offset


def _offset(stamp: Any) -> float:
    """Seconds from a stream timestamp ("HH:MM:SS.fff" or a timedelta)."""
    if hasattr(stamp, 'total_seconds'):
        return stamp.total_seconds()
    try:
        h, m, s = str(stamp).strip().split(':')
        return int(h) * 3600 + int(m) * 60 + float(s)
    except (TypeError, ValueError):
        return 0.0


class LiveManager:
    """One source at a time, and the shared state the API reads."""

    def __init__(self, recording_dir: Path, cache_dir: str | None = None) -> None:
        self.state = LiveState()
        self.source: Source | None = None
        self.recording_dir, self.cache_dir = recording_dir, cache_dir
        self.lock = threading.Lock()
        self.backfill_status: dict[str, Any] = {'running': False, 'laps': 0, 'error': None, 'finished_at': None, 'path': None}

    BACKFILL_TOPICS = ('DriverList', 'TimingData', 'TimingAppData', 'CarData.z', 'Position.z')

    def backfill(self, reader: Callable | None = None) -> dict[str, Any]:
        """Completed laps from before the live connection (or the whole session once it has ended): the session's
        archived streams run through a scratch state with the same lap engine, and laps the live state lacks are added.
        Runs in the background; `backfill_status` reports progress."""
        path = ((self.state.topics.get('SessionInfo') or {}).get('Path') or '').strip('/')
        if not path:
            raise ValueError('No session yet: connect to live timing first.')
        if self.backfill_status['running']:
            return dict(self.backfill_status)
        self.backfill_status = {'running': True, 'laps': 0, 'error': None, 'finished_at': None, 'path': path}
        state = self.state

        def run() -> None:
            try:
                scratch = LiveState()
                loader = ReplaySource(scratch, '/static/' + path + '/', fetch=reader or archive_stream_reader())
                events = loader._load(self.BACKFILL_TOPICS)
                if not events:
                    raise RuntimeError('Formula 1 has not published this session\'s data yet.')
                base = loader._utc_base(events)
                # First pass: geometry only (outline, timing line, sector boundaries); then a clean pass that cuts laps.
                for offset, topic, data in events:
                    if topic in ('Position.z', 'TimingData', 'CarData.z'):
                        scratch.apply(topic, data, base + offset if base else None)
                geometry = (scratch.outline_loop, list(scratch.line_points), [list(p) for p in scratch.sector_points])
                scratch = LiveState()
                scratch.outline_loop = geometry[0]
                scratch.line_points.extend(geometry[1])
                for mine, learned in zip(scratch.sector_points, geometry[2]):
                    mine.extend(learned)
                for offset, topic, data in events:
                    scratch.apply(topic, data, base + offset if base else None)
                scratch._flush_laps(force=True)
                added = 0
                with state.lock:
                    for number, laps in scratch.laps.items():
                        for lap, record in laps.items():
                            if lap not in state.laps[number]:
                                state.laps[number][lap] = record
                                added += 1
                    if state.outline_loop is None and scratch.outline_loop:
                        state.outline_loop = scratch.outline_loop
                    if len(state.line_points) < 5:
                        state.line_points.extend(scratch.line_points)
                    for mine, theirs in zip(state.sector_points, scratch.sector_points):
                        if len(mine) < 5:
                            mine.extend(theirs)
                    state.version += 1
                self.backfill_status['laps'] = added
            except Exception as exc:
                self.backfill_status['error'] = f'Could not load earlier laps: {exc}'
            finally:
                self.backfill_status.update(running=False, finished_at=time.time())

        threading.Thread(target=run, daemon=True, name='live-backfill').start()
        return dict(self.backfill_status)

    def start_live(self) -> dict[str, Any]:
        with self.lock:
            self._stop()
            self.state.reset()
            self.source = LiveSource(self.state, self.recording_dir)
            self.source.start()
            threading.Thread(target=self._watch_missing_laps, args=(self.source,), daemon=True, name='live-backfill-watch').start()
            return self.status()

    def _watch_missing_laps(self, source: 'Source', every: float = 90.0) -> None:
        """While connected live: when laps are missing (completed before connecting, or during a gap), load them from
        F1's archive. F1 publishes a session's archive when it ends, so this keeps trying until it succeeds."""
        while not source.stop_event.wait(every):
            status = self.backfill_status
            path = ((self.state.topics.get('SessionInfo') or {}).get('Path') or '').strip('/')
            recent = status.get('finished_at') and time.time() - status['finished_at'] < every and status.get('path') == path and not status.get('error')
            if path and not status.get('running') and not recent and self.state.missing_laps():
                try:
                    self.backfill()
                except ValueError:
                    pass

    def start_replay(self, path: str, speed: float = 1.0, start: float = 0.0, archive: bool = False) -> dict[str, Any]:
        with self.lock:
            self._stop()
            self.state.reset()
            self.source = ReplaySource(self.state, path, speed, start, self.cache_dir, fetch=archive_stream_reader() if archive else None)
            self.source.start()
            return self.status()

    def stop(self) -> dict[str, Any]:
        with self.lock:
            self._stop()
            return self.status()

    def _stop(self) -> None:
        if self.source:
            self.source.stop()
            self.source.join(timeout=3)
        self.source = None

    def status(self) -> dict[str, Any]:
        return {'source': self.source.describe() if self.source else None, 'auth': stored_token_status(),
                'backfill': dict(self.backfill_status),
                'version': self.state.version, 'messages': self.state.messages}
