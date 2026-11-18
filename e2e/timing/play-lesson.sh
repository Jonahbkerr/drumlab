#!/bin/zsh
# open Learn and start a lesson by title
B="$HOME/.claude/skills/gstack/browse/dist/browse"
title=${1:-Backbeat Basics}
$B goto http://localhost:5173/ >/dev/null && $B eval e2e/timing/mute.js >/dev/null; sleep 0.4
$B js "([...document.querySelectorAll('.lesson-row')].find(r => r.querySelector('.title')?.textContent === '$title').click(), 'ok')" >/dev/null
sleep 0.3
