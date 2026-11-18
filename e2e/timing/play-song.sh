#!/bin/zsh
# open Songs, pick a song row by title and a level by name, press Play
B="$HOME/.claude/skills/gstack/browse/dist/browse"
title=$1; level=$2
$B goto http://localhost:5173/ >/dev/null && $B eval e2e/timing/mute.js >/dev/null
$B click '.nav button:nth-child(2)' >/dev/null; sleep 0.6
$B js "(() => { const row = [...document.querySelectorAll('.song-row')].find(r => r.querySelector('.song-title')?.textContent === '$title'); [...row.querySelectorAll('.ladder button')].find(b => b.querySelector('.step')?.textContent === '$level').click(); return 'level'; })()" >/dev/null; sleep 0.2
$B js "(() => { const row = [...document.querySelectorAll('.song-row')].find(r => r.querySelector('.song-title')?.textContent === '$title'); row.querySelector('.song-actions .btn-primary').click(); return 'play'; })()" >/dev/null
for i in {1..30}; do [ "$($B js "window.__engine?.phase" | grep -v UNTRUSTED | tail -1)" = "playing" ] && break; sleep 0.5; done
$B js "window.__engine.chart.id" | grep -v UNTRUSTED | tail -1
