# Timing robot

End-to-end hit-timing checks in a real (headless, muted) Chromium, driven by
gstack `browse`. Run from the repo root with the dev server on :5173.

- `mute.js` routes every AudioContext through a zero-gain node (nothing
  reaches the speakers) and exposes the full-volume mix as `window.__preBus`.
- `ear.js` is an AudioWorklet on that mix that reports the render time of
  every sound onset, verified to 0.02 ms against scheduled clicks.
- `robot.js` (songs) presses the lane key at the instant each note's audio
  reaches the speakers (`AudioContext.getOutputTimestamp`), like a perfect
  player, and reports how the game judged it. Options: hold each key event
  N ms (busy page), hit every 3rd note late, skip notes, shift all hits
  (slow speakers).
- `robot-lesson.js` listens to the lesson's metronome with the ear and hits
  every note on the beat grid those clicks define, at the moment it is heard.

- `fake-midi.js` replaces Web MIDI with a fake USB kit; `window.__midiHit(38)`
  sends a hit (used to test pad assignment on the Kit page).

```bash
e2e/timing/lesson-test.sh 12                 # Backbeat Basics, 12 s
e2e/timing/song-test.sh "Full kit" 0 26      # first song in the list
e2e/timing/play-song.sh one-step-closer "Full kit"
# then: browse eval e2e/timing/robot.js; browse js "window.__robot.run(10)"
```

Note: the judged mean depends on the audio device's clock step. With
128-frame callbacks (2.7 ms) runs land around +1 ms; with 256-frame
callbacks (5.3 ms) around -4 ms, because the clock reads up to one step
behind. Both are far inside the 40 ms Perfect window.

Results on 2026-11-18 (reported output latency 173 ms in the test browser):
lessons 47/47 perfect, mean +1.3 ms; songs 93/93 perfect, mean +1.5 ms;
with input events held 12 ms, +1.0 ms from the event time; 30 ms of extra
speaker delay detected on the results screen and corrected to −0.3 ms.
