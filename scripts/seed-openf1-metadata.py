"""Save OpenF1's meeting and session lists to the raw archive, so sessions can be found with OpenF1 unreachable.

usage: seed-openf1-metadata.py [first_year] [last_year]   (defaults: 2023 and the current year)
       seed-openf1-metadata.py --status                    (what is saved, no network)

Run it whenever OpenF1 is reachable (not during a live session: it answers HTTP 401 to everyone then). The server also saves each list
it fetches, so this only fills in what has not been opened yet. Safe to repeat: a list is rewritten only when OpenF1 returns rows.
"""
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


def status(first, last):
    for year in range(first, last + 1):
        saved = server._saved_openf1_metadata(server.openf1_url('meetings', year=year))
        if not saved:
            print(f'{year}: no meeting list saved')
            continue
        with_sessions = sum(1 for m in saved if server._saved_openf1_metadata(server.openf1_url('sessions', year=year, meeting_key=m['meeting_key'])))
        print(f'{year}: {len(saved)} meetings, {with_sessions} with their session list saved')


def seed(first, last):
    for year in range(first, last + 1):
        try:
            meetings = server.openf1('meetings', year=year)
        except OSError as exc:
            print(f'{year}: OpenF1 did not answer ({exc}); stopping. Try again when no session is live.')
            return 1
        saved = 0
        for meeting in meetings:
            if meeting.get('meeting_key') is None:
                continue
            try:
                if server.openf1('sessions', year=year, meeting_key=meeting['meeting_key']):
                    saved += 1
            except OSError as exc:
                print(f'  {meeting.get("meeting_name")}: {exc}')
        print(f'{year}: {len(meetings)} meetings, {saved} session lists saved')
    return 0


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    first = int(args[0]) if args else 2023
    last = int(args[1]) if len(args) > 1 else date.today().year
    if '--status' in sys.argv:
        status(first, last)
    else:
        sys.exit(seed(first, last))
