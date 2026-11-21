#!/usr/bin/env bash
# Capture finished seasons' race and practice analyses through local compute, patiently, so the published site has every
# season. Safe to run again at any time (after a power cut, a restart): captured sessions are cached and skipped, so it
# resumes where it stopped.
#
#   bash scripts/backfill-seasons.sh              # the seasons still incomplete
#   bash scripts/backfill-seasons.sh 2019 2018    # just these
#
# FastF1 allows 500 requests an hour per process. Hitting that limit makes the server mark the timing archive unusable
# for a day (.apex-cache/archive-*unavailable-*); those markers are not real outages, so each pass clears them. A pass
# that was rate limited waits an hour, one that skipped events 20 minutes, then repeats (at most six passes a season).
# Progress goes to .apex-cache/backfill.log as well as the terminal.
cd "$(dirname "$0")/.." || exit 1
log_file=.apex-cache/backfill.log
say() { echo "$(date '+%Y-%m-%d %H:%M') $*" | tee -a "$log_file"; }
years=("$@"); [ ${#years[@]} -eq 0 ] && years=(2023 2020 2019 2018)

# Local compute answers on 54123; start it when it is not running and wait for it. It runs scripts/backfill_api.py: the
# usual app, reading a timing feed through FastF1's signed-in fetch when the fast path's direct download is refused (the
# official archive for older seasons; the mirror has none of 2018-2020). Stop any compute started another way first.
if ! curl -s -o /dev/null -m 3 http://127.0.0.1:54123/; then
  say "starting local compute (backfill app)"
  APEX_LOCAL_APP=scripts.backfill_api:app nohup npm run local > .apex-cache/local-compute.log 2>&1 &
  for _ in $(seq 1 60); do curl -s -o /dev/null -m 3 http://127.0.0.1:54123/ && break; sleep 3; done
fi

races() { node -e "const i=require('./assets/data/local-captures/index.json');console.log(Object.keys(i.entries).filter(k=>k.startsWith('/api/performance?')&&k.includes('year=$1')&&/session=R(&|$)/.test(k)).length)"; }
for y in "${years[@]}"; do
  for attempt in 1 2 3 4 5 6; do
    rm -f .apex-cache/archive-unavailable-* .apex-cache/archive-season-unavailable-*
    out=$(node scripts/precompute-local.mjs --year "$y" --season --capture --finished-season --practice 2>&1); code=$?
    skipped=$(echo "$out" | grep -c '"skipped"'); limited=$(echo "$out" | grep -c '500 calls/h')
    say "$y pass $attempt: exit $code, skipped $skipped, rate-limited $limited, race analyses $(races "$y")"
    [ "$code" -ne 0 ] && echo "$out" | grep -m1 -i 'error' | tee -a "$log_file"
    if [ "$code" -eq 0 ] && [ "$limited" -eq 0 ] && { [ "$skipped" -eq 0 ] || [ "$attempt" -ge 3 ]; }; then break; fi
    if [ "$limited" -gt 0 ]; then sleep 3700; else sleep 1200; fi
  done
done
say "backfill finished"
