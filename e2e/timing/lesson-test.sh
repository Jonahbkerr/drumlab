#!/bin/zsh
# fresh muted page → Grooves → first lesson → robot listens to clicks and plays for N seconds
B="$HOME/.claude/skills/gstack/browse/dist/browse"
secs=${1:-10}
e2e/timing/play-lesson.sh 'Backbeat Basics'
$B js "(window.__engine.setMetronome(true), 'metronome on')" >/dev/null
$B eval e2e/timing/ear.js >/dev/null; sleep 0.3
$B eval e2e/timing/robot-lesson.js | grep -v UNTRUSTED | tail -1
sleep $secs
echo "LESSON: $($B js 'window.__robotLesson.stop()' | grep -v UNTRUSTED | tail -1)"
$B console --errors | grep -v UNTRUSTED | tail -2
