#!/bin/zsh
# fresh muted page → My songs → play level → robot hits on heard audio
B="$HOME/.claude/skills/gstack/browse/dist/browse"
level=${1:-Full kit}; queue=${2:-0}; secs=${3:-12}
$B goto http://localhost:5173/ >/dev/null && $B eval e2e/timing/mute.js >/dev/null
ref=$($B snapshot -i | grep 'My songs' | grep -o "@e[0-9]*" | head -1); $B click $ref >/dev/null; sleep 0.5
ref=$($B snapshot -i | grep "$level" | grep -o "@e[0-9]*" | head -1); $B click $ref >/dev/null
ref=$($B snapshot -i | grep "Play $level" | grep -o "@e[0-9]*" | head -1); $B click $ref >/dev/null
for i in {1..30}; do [ "$($B js "window.__engine?.phase" | grep -v UNTRUSTED | tail -1)" = "playing" ] && break; sleep 0.5; done
sleep 3
$B eval e2e/timing/robot.js >/dev/null
$B js "window.__robot.run($secs, $queue)" | grep -v UNTRUSTED | tail -1
sleep $((secs + 2))
echo "SONG ($level, input queued ${queue}ms): $($B js 'window.__robotResult' | grep -v UNTRUSTED | tail -1)"
