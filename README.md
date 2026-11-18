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

## How song charts are made

`src/engine/chart/`

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
5. **Levels**: every saved song keeps its analysis, and each level is
   arranged from it on demand, each one containing the level below:
   1 Pulse (kick + snare on the beat), 2 Backbeat (kick + snare on 8ths),
   3 Groove (+ hats and crashes, 8ths), 4 Full kit (16ths, toms, fills),
   5 Master (+ ghost notes). A level adding under 5% more notes than the one
   below is hidden. Stars are tracked per level; the song card suggests the
   first level without stars, and results offer the next level.

In play, the highway clock is the backing track's playhead minus the
device's output latency, so notes stay locked to what you hear at any
practice tempo; count-in, metronome and the beat lines follow the tracked
beats.

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
