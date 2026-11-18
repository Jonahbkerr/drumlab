#!/bin/zsh
# fresh muted page → Grooves → first lesson → robot listens to clicks and plays for N seconds
B="$HOME/.claude/skills/gstack/browse/dist/browse"
secs=${1:-10}
$B goto http://localhost:5173/ >/dev/null && $B eval e2e/timing/mute.js >/dev/null
ref=$($B snapshot -i | grep 'Grooves' | grep -o "@e[0-9]*" | head -1); $B click $ref >/dev/null
ref=$($B snapshot -i | grep 'Backbeat' | grep -o "@e[0-9]*" | head -1); $B click $ref >/dev/null
sleep 0.3
$B js "(window.__engine.setMetronome(true), 'metronome on')" >/dev/null
$B eval e2e/timing/ear.js >/dev/null; sleep 0.3
$B eval e2e/timing/robot-lesson.js | grep -v UNTRUSTED | tail -1
sleep $secs
echo "LESSON: $($B js 'window.__robotLesson.stop()' | grep -v UNTRUSTED | tail -1)"
$B console --errors | grep -v UNTRUSTED | tail -2
