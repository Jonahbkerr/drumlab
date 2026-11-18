# DrumLab

A drum trainer for electronic kits: guided lessons (rudiments, grooves, fills),
USB/MIDI kit input with per-pad mapping, and **your own songs as playable drum
charts**. Drop in an MP3 and the drum part is transcribed in the browser:
kick, snare, hi-hat, toms and cymbals, on the song's own beat, at four
difficulty levels.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

Plug the kit in over USB before opening the page (Chrome or Edge, which have
Web MIDI). Kit setup maps pads to lanes; keyboard fallback is D F J K L ;.

A drawn kit (hi-hat, snare, kick, high and low tom, crash) sits under the play
chart and on the Kit page. Each pad hit lights its drum, brighter for harder
hits; a drum's ring glows as its next note comes up and flashes red on a miss.
On the Kit page, click a drum and hit a pad to assign it. Hide the kit from the
play screen's settings panel.

## How song charts are made

`src/engine/chart/`

0. **Drum separation** (on by default, "Separate the drums first" on import):
   Demucs v4 (`htdemucs_ft` drums specialist, Meta, MIT) separates the drums
   from the music, and kick, snare and toms are read from that drum stem,
   where guitars, bass and vocals cannot pass for drums. Hi-hats, cymbals,
   tempo and bars still come from the full mix, where cymbal attacks are
   intact (`mergeStem` in `pipeline.ts`). The import preview appears from
   the full mix in seconds and sharpens when separation is done; a song saved
   earlier is updated when it finishes. Re-chart separates existing songs.
   - Model: `htdemucs_ft_drums_safe16.onnx` (88 MB, an onnxruntime-web
     export by monteslu/htdemucs-ft-webgpu on Hugging Face), downloaded once,
     checked against its SHA-256 and kept in Cache Storage. Dev builds use
     `local/models/demucs/` first if it holds a copy.
   - The ONNX graph is the network only; `demucs.ts` does Demucs' own
     spectrogram and inverse (exact to 160 dB, `bench/demucs.test.ts`) and
     the 7.8 s overlapping segments.
   - Speed: on WebGPU about 0.9 s per 7.8 s segment (a 2:35 song imported,
     separated and charted in 30 s on an M-series Mac). The model is fp16 and
     two parts of it break on WebGPU (the input normalization overflows; the
     time decoder's 1-D transposed convolutions come out wrong), so those 20
     nodes run on the CPU (`DEMUCS_CPU_NODES`), and on first use the worker
     checks one test segment on GPU and CPU and only uses the GPU if they
     agree. Without a usable GPU: CPU with 8 threads, about real time.
     The worker uses onnxruntime-web's WebGPU build for both models (its
     wasm is 6.9 MB gzipped, 3.3 MB more than the CPU-only one; fetched once,
     when a song is first imported).
     Threads need cross-origin isolation, which `vite.config.ts` turns on
     (COOP same-origin, COEP credentialless); any host serving DrumLab needs
     the same two headers.
   - Measured: on the test songs, kick 100, snare 98→99, hi-hat 96, crash
     95 (stem alone loses cymbals: crash 81). In In The End's verse the
     stem finds the second kick of every bar that the full mix dropped in 5
     of 8 bars. `npx tsx bench/run.ts hybrid` (needs the local model),
     `bench/stem-songs.ts` and `bench/compare-bars.ts` compare real songs.
1. **Drum model**: ADTOF Frame_RNN (CNN + 3 bidirectional GRUs) turns a
   log-filtered spectrogram (100 frames/s, 84 bands) into per-frame
   probabilities for kick, snare, tom, hi-hat, cymbal. It runs with
   onnxruntime-web in a Web Worker: about 5 s for a 4-minute song.
   The conv front end runs in chunks (it only sees ±4 frames); the recurrent
   back end runs over the whole song, so output matches the reference model
   to 1e-6.
2. **Peaks**: madmom-style peak picking with the model's published per-class
   thresholds; toms split high/low by pitch.
3. **Beats**: tempo from an autocorrelation comb over the drum activity,
   beats by dynamic programming (Ellis 2007), bar starts from kick/crash on
   1 and the backbeat on 2 and 4.
4. **Arrangement**: notes snap to a 16th grid built from the tracked beats,
   one per lane per slot, at most two hand drums at once.
   **Repeated bars agree**: soft notes near the threshold flicker in and out
   from bar to bar, so the bars that repeat a bar's groove (same confident
   notes) decide its uncertain notes together, by their average strength.
   Two-bar patterns, pickups at the same place in every 4-bar phrase, loud
   one-offs and fills are left alone (`bench/vote-check.ts` checks every
   decision against the test songs' exact parts: no real note dropped).
   `bench/consistency.ts song.mp3` measures how often a real song's bars
   repeat exactly.
5. **Levels**: every saved song keeps its analysis, and each level is
   arranged from it on demand, each one containing the level below:
   1 Pulse (kick + snare on the beat), 2 Backbeat (kick + snare on 8ths),
   3 Groove (+ hats and crashes, 8ths), 4 Full kit (16ths, toms, fills),
   5 Master (+ ghost notes). A level adding under 5% more notes than the one
   below is hidden. Stars are tracked per level; the song card suggests the
   first level without stars, and results offer the next level.

## Timing

Songs and lessons run on one rule: the game clock is the audio render clock
minus the output latency (what reaches your ears), so notes, clicks and
judging all line up with what you hear, at any practice tempo. Songs use the
backing track's playhead; lessons the audio clock, with count-in and
metronome clicks scheduled ahead on the audio clock (beat-tracked songs click
on their tracked beats). Hits are judged at the input event's own timestamp
(keyboard, pads, MIDI), not when the page got round to handling it, and hits
during the count-in count.

Output latency defaults to what the device reports. If your speakers or
headphones add more, the results screen notices a steady early/late lean and
offers to shift timing by that amount (☰ Menu → Audio sync to adjust).

`e2e/timing/` holds the robot drummer that checks all of this in a real
browser by hitting notes when their sound reaches the speakers.

## Chart quality bench

```bash
npm test           # regression test (fails if quality drops)
npm run bench      # per-song table: old generator vs current
npx tsx bench/tab.ts song.mp3 8 8   # print a real song's chart as drum tab
```

Six synthetic full mixes with exact drum parts (rock, four-on-the-floor,
swung hip-hop, half-time metal, funk with ghost notes, ride ballad), scored
per lane at ±50 ms:

| generator | kick | snare | hi-hat | cymbal | overall F |
|---|---|---|---|---|---|
| original (band thresholds) | 43 | 31 | 0 | 0 | 25 |
| ADTOF + beat grid (current) | 100 | 99 | 95 | 91 | 96 |

All six tempos are detected correctly; mean timing offset is −3 ms.

## Model and license

The drum model is **ADTOF** by Mickaël Zehren, Marco Alunno and Paolo
Bientinesi ("High-Quality and Reproducible Automatic Drum Transcription from
Crowdsourced Data", *Signals* 2023), via the PyTorch port by Xavier Riley
(github.com/xavriley/ADTOF-pytorch). The weights are licensed
**CC BY-NC-SA 4.0: non-commercial use only.** `public/models/*.onnx` are a
format conversion of those weights and carry the same license. Before
DrumLab is sold or used commercially, the model has to be replaced or
licensed.

To regenerate the ONNX files: clone the port, then

```bash
python -I tools/adtof_export.py <ADTOF-pytorch checkout> <out dir> [reference.wav …]
npx tsx bench/adtof-check.ts <out dir> reference.wav   # TS port vs PyTorch
```
