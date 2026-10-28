"""Mirror raw OpenF1 telemetry for finished sessions onto this PC.

    .venv/Scripts/python.exe scripts/mirror-openf1.py --year 2026
    .venv/Scripts/python.exe scripts/mirror-openf1.py --year 2026 --gp "Singapore Grand Prix"
    .venv/Scripts/python.exe scripts/mirror-openf1.py --year 2026 --dry-run
    .venv/Scripts/python.exe scripts/mirror-openf1.py --year 2026 --watch 30

--watch keeps the archive current without polling. The F1 schedule (as OpenF1
publishes it) says when every session ends; each session is archived once it
has settled, six hours after it ends (timing corrections), so the watcher
sleeps until then and does one pass. If a session overruns or its data is late
it retries every 20 minutes, up to three days. Between weekends it only wakes
to re-read the schedule. A finished session is recorded in mirror-state.json
(next to the data), so a pass with nothing new costs one request. A driver
with no data in a session is recorded as empty instead of being retried.

Downloads each driver's whole-session car data, position and laps for every
finished qualifying, sprint qualifying, sprint and race, through server.openf1:
the same requests, the same disk files (server.RAW_ROOT, ~/apex-data/openf1 by
default, outside every checkout; APEX_RAW_ROOT overrides) and the same
process-wide pacing as the backend. The backend then serves any lap of those
sessions from disk (openf1_session_stream) instead of calling OpenF1.

Resumable: files already on disk are skipped, so stopping and running again
continues where it left off. By default only settled sessions (ended over six
hours ago) are written. --include-recent explicitly captures finished snapshots;
live and future sessions remain excluded. Raw data does not depend on the
methodology revision, so it is downloaded once.
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
import argparse
import atexit
import gzip
import json
import os
import sys
import time
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server

SESSIONS = ("Qualifying", "Sprint Qualifying", "Sprint Shootout", "Sprint", "Race")
STREAMS = ("car_data", "location", "laps")


def settled(session: dict, minimum_hours: float = 6) -> bool:
    end = session.get("date_end")
    if not end:
        return False
    finished = datetime.fromisoformat(str(end).replace("Z", "+00:00"))
    return datetime.now(timezone.utc)-finished > timedelta(hours=minimum_hours)


def on_disk(endpoint: str, session_key, driver_number) -> bool:
    path = server.openf1_cache_path(server.openf1_url(endpoint, session_key=session_key, driver_number=driver_number))
    if not path.exists():
        return False
    try:
        with gzip.open(path, "rb") as handle:
            handle.read(1)
        return True
    except OSError:
        path.unlink(missing_ok=True)
        return False


def capture_stream(endpoint, key, number, *, include_recent=False, refresh=False):
    url = server.openf1_url(endpoint, session_key=key, driver_number=number)
    rows = server._openf1_fetch(url) if refresh else server.openf1(endpoint, session_key=key, driver_number=number)
    if not isinstance(rows, list) or not rows:
        raise ValueError('No source observations returned')
    path = server.openf1_cache_path(url)
    # Captured snapshots are explicit export inputs, not a change to the API's
    # freshness policy. Refresh bypasses even an existing settled disk stream.
    if include_recent or refresh:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix+'.tmp')
        temporary.write_bytes(gzip.compress(json.dumps(rows,separators=(',',':'),allow_nan=False).encode(),mtime=0))
        temporary.replace(path)
    return path.stat().st_size if path.exists() else 0


STATE_NAME = "mirror-state.json"
SETTLE_HOURS = 6          # a session is archived this long after it ends
RETRY_MINUTES = 20        # a session past its settle time that is not archived yet
GIVE_UP_DAYS = 3          # ...is retried for this long
SCHEDULE_CHECK_HOURS = 12 # longest sleep: schedules change (a race moved, a session added)


def load_state() -> dict:
    try:
        return json.loads((server.RAW_ROOT/STATE_NAME).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"sessions": {}}


def save_state(state: dict) -> None:
    server.RAW_ROOT.mkdir(parents=True, exist_ok=True)
    temporary = server.RAW_ROOT/(STATE_NAME+".tmp")
    temporary.write_text(json.dumps(state, indent=1, sort_keys=True), encoding="utf-8")
    temporary.replace(server.RAW_ROOT/STATE_NAME)


def is_empty(error: Exception) -> bool:
    """OpenF1 has nothing for this driver in this session (a car that never ran)."""
    return (isinstance(error, urllib.error.HTTPError) and error.code == 404) or "No source observations" in str(error)


def run_once(args, wanted) -> int:
    """One pass over the finished sessions of a year. Returns the number of failed streams."""
    state = load_state()
    done_sessions = state["sessions"]
    # Cancelled sessions stay listed (2026: Bahrain and Saudi Arabia in April) but have no data.
    sessions = [s for s in server.openf1("sessions", year=args.year)
                if s.get("session_name") in wanted and settled(s, 0 if args.include_recent else 6) and not s.get("is_cancelled")]
    if args.gp:
        keys = {(server.openf1_session(args.year, args.gp, name) or {}).get("session_key") for name in wanted}
        sessions = [s for s in sessions if s.get("session_key") in keys]
    if not args.refresh and not args.gp:
        sessions = [s for s in sessions if str(s["session_key"]) not in done_sessions]
    if not sessions:
        print("Nothing new: every finished session is already archived.", flush=True)
        return 0

    jobs = []
    for session in sessions:
        key = session["session_key"]
        drivers = sorted({str(d["driver_number"]) for d in server.openf1("drivers", session_key=key) if d.get("driver_number") is not None}, key=int)
        known_empty = set(done_sessions.get(str(key), {}).get("empty", []))
        missing = [(endpoint, key, number) for number in drivers for endpoint in STREAMS
                   if (args.refresh or not on_disk(endpoint, key, number)) and f"{endpoint}:{number}" not in known_empty]
        label = f"{session.get('location') or session.get('circuit_short_name')} {session['session_name']}"
        print(f"{label:<34} {len(drivers):>2} drivers  {len(missing):>3} of {len(drivers)*len(STREAMS)} streams to fetch", flush=True)
        jobs += [(label, *job) for job in missing]
        session["_label"] = label
    print(f"{len(sessions)} sessions, {len(jobs)} streams to fetch", flush=True)
    if args.dry_run:
        return 0

    started, done, failed, size = time.monotonic(), 0, [], 0
    empty = {}

    def fetch(job):
        label, endpoint, key, number = job
        return capture_stream(endpoint, key, number, include_recent=args.include_recent, refresh=args.refresh)

    with ThreadPoolExecutor(max_workers=max(1, args.workers), thread_name_prefix="mirror") as pool:
        futures = {pool.submit(fetch, job): job for job in jobs}
        for future in as_completed(futures):
            label, endpoint, key, number = futures[future]
            done += 1
            try:
                size += future.result()
            except Exception as error:  # keep going; a rerun retries what failed
                if is_empty(error):
                    empty.setdefault(key, []).append(f"{endpoint}:{number}")
                else:
                    failed.append((key, f"{label} #{number} {endpoint}: {error}"))
            if done % 10 == 0 or done == len(jobs):
                elapsed = time.monotonic()-started
                eta = elapsed/done*(len(jobs)-done)
                print(f"{done}/{len(jobs)} streams  {size/1e6:.0f} MB  {elapsed/60:.1f} min elapsed  ~{eta/60:.0f} min left", flush=True)
    failed_keys = {key for key, _ in failed}
    if not args.refresh:
        for session in sessions:
            key = session["session_key"]
            if key in failed_keys:
                continue  # incomplete: the next pass retries it
            entry = done_sessions.setdefault(str(key), {})
            entry.update({"label": session["_label"], "complete_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                          "empty": sorted(set(entry.get("empty", [])) | set(empty.get(key, [])))})
    save_state(state)
    for _, line in failed:
        print("failed:", line)
    print(f"done: {done-len(failed)-sum(map(len, empty.values()))} streams, {size/1e6:.0f} MB, "
          f"{sum(map(len, empty.values()))} empty at the source, {len(failed)} failed (run again to retry)", flush=True)
    return len(failed)


LOCK_NAME = "mirror-watch.lock"


def pid_alive(pid: int) -> bool:
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes
        handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        code = wintypes.DWORD()
        ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
        ctypes.windll.kernel32.CloseHandle(handle)
        return code.value == 259  # STILL_ACTIVE
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def acquire_watch_lock() -> int | None:
    """One watcher at a time: they would share, and so halve, the rate limit.
    Returns None when this process holds the lock, else the PID that does."""
    path = server.RAW_ROOT/LOCK_NAME
    server.RAW_ROOT.mkdir(parents=True, exist_ok=True)
    try:
        holder = int(path.read_text().strip())
    except (OSError, ValueError):
        holder = None
    if holder and holder != os.getpid() and pid_alive(holder):
        return holder
    path.write_text(str(os.getpid()))
    atexit.register(lambda: path.unlink(missing_ok=True) if path.exists() and path.read_text().strip() == str(os.getpid()) else None)
    return None


def next_wake(args, wanted, now=None):
    """Seconds until the watcher should run again, and why, from the published schedule."""
    now = now or datetime.now(timezone.utc)
    settle = timedelta(hours=0 if args.include_recent else SETTLE_HOURS)
    archived = load_state()["sessions"]
    waits, overdue = [], []
    for s in server.openf1("sessions", year=args.year):
        if s.get("session_name") not in wanted or s.get("is_cancelled") or not s.get("date_end") or str(s["session_key"]) in archived:
            continue
        ends = datetime.fromisoformat(str(s["date_end"]).replace("Z", "+00:00"))
        due = ends+settle
        label = f"{s.get('location') or s.get('circuit_short_name')} {s['session_name']}"
        if due > now:
            waits.append((due-now, label, due))
        elif now-due < timedelta(days=GIVE_UP_DAYS):
            overdue.append(label)
    if overdue:
        return RETRY_MINUTES*60., f"{', '.join(overdue[:3])} past their settle time and not archived yet"
    if waits:
        wait, label, due = min(waits)
        seconds = wait.total_seconds()+120  # a little after, so OpenF1 has the final data
        if seconds > SCHEDULE_CHECK_HOURS*3600:
            return SCHEDULE_CHECK_HOURS*3600., f"next is {label} at {due.astimezone().strftime('%a %d %b %H:%M')}; re-reading the schedule first"
        return seconds, f"{label} settles {due.astimezone().strftime('%a %d %b %H:%M')}"
    return SCHEDULE_CHECK_HOURS*3600., "no unarchived sessions left on the schedule"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--year", type=int, default=datetime.now().year)
    parser.add_argument("--gp", help="one Grand Prix, by its calendar name")
    parser.add_argument("--sessions", default=",".join(SESSIONS), help="comma-separated OpenF1 session names")
    parser.add_argument("--workers", type=int, default=3, help="concurrent downloads (pacing still applies)")
    parser.add_argument("--dry-run", action="store_true", help="list what is missing without downloading")
    parser.add_argument("--include-recent", action="store_true", help="capture finished sessions inside the six-hour correction window")
    parser.add_argument("--refresh", action="store_true", help="replace selected raw streams instead of resuming")
    parser.add_argument("--watch", action="store_true", help="keep running: archive each session once it has settled, following the published schedule")
    args = parser.parse_args()
    wanted = {name.strip() for name in args.sessions.split(",") if name.strip()}
    print(f"Archive: {server.RAW_ROOT}", flush=True)
    if args.watch and (holder := acquire_watch_lock()):
        print(f"Another watcher is already running (PID {holder}); nothing to do.", flush=True)
        return
    if not args.watch:
        if run_once(args, wanted):
            raise SystemExit(1)
        return
    follow_year = "--year" not in sys.argv  # a long-lived watcher moves on when the calendar year does
    while True:
        seconds, why = RETRY_MINUTES*60., "last pass failed"
        if follow_year:
            args.year = datetime.now().year
        try:
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M')}] checking {args.year}", flush=True)
            if run_once(args, wanted):
                why = "some streams failed"
            else:
                seconds, why = next_wake(args, wanted)
        except Exception as error:  # a network blip must not end the watch
            print("pass failed:", error, flush=True)
        print(f"sleeping {seconds/3600:.1f} h: {why}", flush=True)
        time.sleep(seconds)


if __name__ == "__main__":
    main()
