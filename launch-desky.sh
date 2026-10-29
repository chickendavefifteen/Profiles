#!/usr/bin/env bash
cd /home/dh/profiles-hackathon

# Export Wayland and Hyprland GUI environment from user session
export XDG_RUNTIME_DIR=/run/user/1000
export WAYLAND_DISPLAY=wayland-1
export DISPLAY=:0
export HYPRLAND_INSTANCE_SIGNATURE=$(cat /proc/$(pgrep -u dh -x Hyprland | head -1)/environ 2>/dev/null | tr "\0" "\n" | grep HYPRLAND_INSTANCE_SIGNATURE | cut -d= -f2)
export WEBKIT_DISABLE_DMABUF_RENDERER=1

pkill -f "node server.mjs --port 1420" 2>/dev/null || true
pkill -f "src-tauri/target/release/profiles" 2>/dev/null || true
pkill -f "src-tauri/target/debug/profiles" 2>/dev/null || true
sleep 1

nohup node server.mjs --port 1420 > /tmp/profiles-server-1420.log 2>&1 < /dev/null &
sleep 1

nohup ./src-tauri/target/release/profiles > /tmp/profiles-app.log 2>&1 < /dev/null &
sleep 3

hyprctl dispatch "hl.dsp.window.move({ window = 'class:profiles', workspace = '2', follow = false })" 2>/dev/null || true
