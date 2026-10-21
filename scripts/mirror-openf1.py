"""Mirror raw OpenF1 telemetry for finished sessions onto this PC.

    .venv/Scripts/python.exe scripts/mirror-openf1.py --year 2026
    .venv/Scripts/python.exe scripts/mirror-openf1.py --year 2026 --gp "Singapore Grand Prix"
    .venv/Scripts/python.exe scripts/mirror-openf1.py --year 2026 --dry-run

Downloads each driver's whole-session car data, position and laps for every
finished qualifying, sprint qualifying, sprint and race, through server.openf1:
the same requests, the same disk files (.apex-cache/openf1) and the same
process-wide pacing as the backend. The backend then serves any lap of those
sessions from disk (openf1_session_stream) instead of calling OpenF1.

Resumable: files already on disk are skipped, so stopping and running again
continues where it left off. Only settled sessions (ended over six hours ago)
are written; live weekends stay on demand. Raw data does not depend on the
methodology revision, so it is downloaded once.
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
import argparse
import gzip
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server

SESSIONS = ("Qualifying", "Sprint Qualifying", "Sprint Shootout", "Sprint", "Race")
STREAMS = ("car_data", "location", "laps")


def settled(session: dict) -> bool:
    end = session.get("date_end")
    if not end:
        return False
    finished = datetime.fromisoformat(str(end).replace("Z", "+00:00"))
    return datetime.now(timezone.utc)-finished > timedelta(hours=6)


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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--year", type=int, default=datetime.now().year)
    parser.add_argument("--gp", help="one Grand Prix, by its calendar name")
    parser.add_argument("--sessions", default=",".join(SESSIONS), help="comma-separated OpenF1 session names")
    parser.add_argument("--workers", type=int, default=3, help="concurrent downloads (pacing still applies)")
    parser.add_argument("--dry-run", action="store_true", help="list what is missing without downloading")
    args = parser.parse_args()
    wanted = {name.strip() for name in args.sessions.split(",") if name.strip()}

    # Cancelled sessions stay listed (2026: Bahrain and Saudi Arabia in April) but have no data.
    sessions = [s for s in server.openf1("sessions", year=args.year)
                if s.get("session_name") in wanted and settled(s) and not s.get("is_cancelled")]
    if args.gp:
        keys = {(server.openf1_session(args.year, args.gp, code) or {}).get("session_key") for code in ("Q", "SQ", "S", "R")}
        sessions = [s for s in sessions if s.get("session_key") in keys]
    if not sessions:
        sys.exit("No finished sessions match.")

    jobs = []
    for session in sessions:
        key = session["session_key"]
        drivers = sorted({str(d["driver_number"]) for d in server.openf1("drivers", session_key=key) if d.get("driver_number") is not None}, key=int)
        missing = [(endpoint, key, number) for number in drivers for endpoint in STREAMS if not on_disk(endpoint, key, number)]
        label = f"{session.get('location') or session.get('circuit_short_name')} {session['session_name']}"
        print(f"{label:<34} {len(drivers):>2} drivers  {len(missing):>3} of {len(drivers)*len(STREAMS)} streams to fetch", flush=True)
        jobs += [(label, *job) for job in missing]
    print(f"{len(sessions)} sessions, {len(jobs)} streams to fetch", flush=True)
    if args.dry_run or not jobs:
        return

    started, done, failed, size = time.monotonic(), 0, [], 0

    def fetch(job):
        label, endpoint, key, number = job
        server.openf1(endpoint, session_key=key, driver_number=number)
        path = server.openf1_cache_path(server.openf1_url(endpoint, session_key=key, driver_number=number))
        return path.stat().st_size if path.exists() else 0

    with ThreadPoolExecutor(max_workers=max(1, args.workers), thread_name_prefix="mirror") as pool:
        futures = {pool.submit(fetch, job): job for job in jobs}
        for future in as_completed(futures):
            label, endpoint, key, number = futures[future]
            done += 1
            try:
                size += future.result()
            except Exception as error:  # keep going; a rerun retries what failed
                failed.append(f"{label} #{number} {endpoint}: {error}")
            if done % 10 == 0 or done == len(jobs):
                elapsed = time.monotonic()-started
                eta = elapsed/done*(len(jobs)-done)
                print(f"{done}/{len(jobs)} streams  {size/1e6:.0f} MB  {elapsed/60:.1f} min elapsed  ~{eta/60:.0f} min left", flush=True)
    for line in failed:
        print("failed:", line)
    print(f"done: {done-len(failed)} streams, {size/1e6:.0f} MB, {len(failed)} failed (run again to retry)")


if __name__ == "__main__":
    main()
