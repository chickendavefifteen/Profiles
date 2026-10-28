#!/bin/bash
# Overnight supervisor for the Profiles build session.
# Nudges the idle build session to continue until MORNING.md exists.
# Bounded: exits at 2026-10-27T07:00Z or when done. Logs progress.
LOG=/home/dh/profiles-hackathon/overnight.log
SESSION=01a17c0f-8431-76c4-837c-f4d2ffdda02d
cd /home/dh/profiles-hackathon || exit 1
echo "$(date -Is) supervisor start" >> "$LOG"
N=0
while [ "$(date -u +%s)" -lt "$(date -u -d 2026-10-27T10:55:00Z +%s)" ]; do
  if [ -f MORNING.md ]; then
    echo "$(date -Is) MORNING.md exists, done" >> "$LOG"
    break
  fi
  STATUS=$(session-control status "$SESSION" --json 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin)['data']; print(d['state'])" 2>/dev/null)
  echo "$(date -Is) session state: ${STATUS:-unknown}" >> "$LOG"
  if [ "$STATUS" = "idle" ]; then
    N=$((N+1))
    OWNER=$(session-control status "$SESSION" --json 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin)['data']; print(d['owner_id'], d['leaf_id'])" 2>/dev/null)
    set -- $OWNER
    session-control nudge "$SESSION" --expect-owner "$1" --expect-leaf "$2" --id "profiles-overnight-nudge-$N" \
      --message "Continue the overnight Profiles build. Re-read BUILD.md and WORKBOARD.md, take the next unfinished step, keep tests passing, and update WORKBOARD.md. Finish with README run instructions and MORNING.md when the morning acceptance test passes." \
      --json >> "$LOG" 2>&1
    echo "$(date -Is) nudged (n=$N)" >> "$LOG"
  fi
  sleep 900
done
echo "$(date -Is) supervisor exit" >> "$LOG"
