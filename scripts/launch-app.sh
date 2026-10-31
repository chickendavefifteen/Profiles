#!/usr/bin/env bash
# The ONLY way to (re)launch the desktop app: fresh bundle, verified match,
# old instance dead, new PID confirmed. Never hand-launch.
set -e
cd "$(dirname "$0")/.."
bash scripts/app-build.sh >/dev/null
STAMP=$(git rev-parse HEAD)
BUILT=$(cat src-tauri/target/debug/profiles.srcsha 2>/dev/null || echo none)
if [ "$STAMP" != "$BUILT" ]; then echo "bundle mismatch: $BUILT vs $STAMP"; exit 1; fi
echo "bundle matches HEAD ($STAMP)"
pkill -x profiles 2>/dev/null || true
pkill -f "node.*server\.mjs.*1420" 2>/dev/null || true
sleep 1
nohup node server.mjs --port 1420 > /tmp/profiles-server.log 2>&1 &
for i in {1..25}; do
  if curl -s http://localhost:1420/api/health | grep -q "$STAMP"; then break; fi
  sleep 0.2
done
export WEBKIT_DISABLE_DMABUF_RENDERER=1 WAYLAND_DISPLAY=wayland-1
setsid nohup ./src-tauri/target/debug/profiles > /tmp/profiles-app.log 2>&1 < /dev/null &
sleep 3
NEWPID=$(pgrep -x profiles | head -1)
[ -n "$NEWPID" ] || { echo "app did not start"; exit 1; }
echo "app running pid=$NEWPID"
