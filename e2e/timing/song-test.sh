#!/bin/zsh
# fresh muted page → My songs → play level → robot hits on heard audio
B="$HOME/.claude/skills/gstack/browse/dist/browse"
level=${1:-Full kit}; queue=${2:-0}; secs=${3:-12}
e2e/timing/play-song.sh in-the-end "$level" >/dev/null
sleep 3
$B eval e2e/timing/robot.js >/dev/null
$B js "window.__robot.run($secs, $queue)" | grep -v UNTRUSTED | tail -1
sleep $((secs + 2))
echo "SONG ($level, input queued ${queue}ms): $($B js 'window.__robotResult' | grep -v UNTRUSTED | tail -1)"
