#!/bin/zsh
# open My songs, pick a song card by title and a level by name, press Play
B="$HOME/.claude/skills/gstack/browse/dist/browse"
title=$1; level=$2
$B goto http://localhost:5173/ >/dev/null && $B eval e2e/timing/mute.js >/dev/null
ref=$($B snapshot -i | grep 'My songs' | grep -o "@e[0-9]*" | head -1); $B click $ref >/dev/null; sleep 0.6
$B js "(() => { const card = [...document.querySelectorAll('.lesson-card')].find(c => c.querySelector('h3')?.textContent === '$title'); [...card.querySelectorAll('.level-chip')].find(b => b.textContent.includes('$level')).click(); return 'chip'; })()" >/dev/null; sleep 0.2
$B js "(() => { const card = [...document.querySelectorAll('.lesson-card')].find(c => c.querySelector('h3')?.textContent === '$title'); [...card.querySelectorAll('button')].find(b => b.textContent.startsWith('▶ Play')).click(); return 'play'; })()" >/dev/null
for i in {1..30}; do [ "$($B js "window.__engine?.phase" | grep -v UNTRUSTED | tail -1)" = "playing" ] && break; sleep 0.5; done
$B js "window.__engine.chart.id" | grep -v UNTRUSTED | tail -1
