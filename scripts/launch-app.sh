#!/usr/bin/env bash
# Build the bundled UI; the native shell owns its sidecar on a fresh port.
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/app-build.sh
binary=$(realpath src-tauri/target/debug/profiles)
runtime="${XDG_STATE_HOME:-$HOME/.local/state}/profiles"
mkdir -p "$runtime"
pidfile="$runtime/development.pid"
if [[ -f "$pidfile" ]]; then
  read -r oldpid < "$pidfile"
  if [[ "$oldpid" =~ ^[0-9]+$ ]] && [[ $(readlink -f "/proc/$oldpid/exe" 2>/dev/null || true) == "$binary" ]]; then
    kill -TERM "$oldpid"
  fi
fi
export PROFILES_HOME="$PWD" WEBKIT_DISABLE_DMABUF_RENDERER=1
setsid nohup "$binary" > "$runtime/development.log" 2>&1 < /dev/null &
pid=$!
printf '%s\n' "$pid" > "$pidfile"
sleep 2
if ! kill -0 "$pid" 2>/dev/null; then
  printf 'Profiles failed to start. Log: %s/development.log\n' "$runtime" >&2
  exit 1
fi
printf 'Profiles running: pid=%s, source=%s\n' "$pid" "$(git rev-parse --short HEAD)"
