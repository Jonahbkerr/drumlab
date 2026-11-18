/**
 * Drum separation plumbing: the spectrogram code must match Demucs'
 * own (torch.stft based) transform exactly, or the model sees garbage.
 * Runs without the model file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { SEGMENT, ispec, spec, testSignature } from '../src/engine/chart/demucs';
import { cpuSignature } from '../src/engine/chart/demucs-check';
import { DEMUCS_PATH, loadDemucs, setThreads } from './model';
import { mergeStem } from '../src/engine/chart/pipeline';
import type { ChartAnalysis } from '../src/engine/chart/pipeline';
import type { Hit } from '../src/engine/chart/arrange';

const PLANE = 2048 * 336;

test('spectrogram round trip is exact away from the segment edges', () => {
  // no content at the top bin, which Demucs drops by design
  const x = Float32Array.from({ length: SEGMENT }, (_, i) => Math.sin(i * 0.01) * 0.5 + Math.sin(i * 0.37) * 0.2 + Math.sin(i * 1.9) * 0.1);
  const re = new Float32Array(PLANE);
  const im = new Float32Array(PLANE);
  spec(x, re, im);
  const y = ispec(re, im, 0, 0);
  let err = 0;
  let sig = 0;
  for (let i = 4096; i < SEGMENT - 4096; i++) {
    err += (x[i] - y[i]) ** 2;
    sig += x[i] ** 2;
  }
  assert.ok(10 * Math.log10(sig / err) > 120, `round trip only ${(10 * Math.log10(sig / err)).toFixed(1)} dB`);
});

test('spectrogram scale and bins match torch.stft(normalized=True)', () => {
  // a 1 kHz sine: peak at bin 1000 * 4096 / 44100 = 92.9, |X| = sum(window) / 2 / sqrt(4096) = 16
  const tone = Float32Array.from({ length: SEGMENT }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / 44100));
  const re = new Float32Array(PLANE);
  const im = new Float32Array(PLANE);
  spec(tone, re, im);
  let best = 0;
  let bin = 0;
  for (let b = 0; b < 2048; b++) {
    const m = Math.hypot(re[b * 336 + 100], im[b * 336 + 100]);
    if (m > best) [best, bin] = [m, b];
  }
  assert.equal(bin, 93);
  assert.ok(Math.abs(best - 16) < 0.5, `peak magnitude ${best}`);
});

test('hybrid takes kick, snare and toms from the stem, the rest from the mix', () => {
  const h = (t: number, lane: Hit['lane']): Hit => ({ t, lane, salience: 1, prob: 1, need: 0.5 });
  const base = { duration: 10, beats: [0, 0.5], period: 0.5, downbeat: 0, novelty: new Float32Array(0) };
  const mix: ChartAnalysis = { ...base, hits: [h(1, 'kick'), h(1, 'hh'), h(2, 'crash'), h(3, 'snare')] };
  const stem: ChartAnalysis = { ...base, beats: [9], hits: [h(1.5, 'kick'), h(1.5, 'hh'), h(2.5, 'tomLo'), h(3.5, 'snare')] };
  const m = mergeStem(mix, stem);
  assert.deepEqual(m.beats, mix.beats, 'beats come from the mix');
  assert.deepEqual(
    m.hits.map((x) => `${x.lane}@${x.t}`),
    ['hh@1', 'kick@1.5', 'crash@2', 'tomLo@2.5', 'snare@3.5'],
  );
});

test('the stored CPU signature (GPU check) still matches the CPU', { skip: !existsSync(DEMUCS_PATH) && 'needs the local model' }, async () => {
  setThreads(8);
  const sig = await testSignature(await loadDemucs());
  const ref = cpuSignature();
  assert.equal(sig.length, ref.length);
  let maxErr = 0;
  for (let i = 0; i < sig.length; i++) maxErr = Math.max(maxErr, Math.abs(sig[i] - ref[i]));
  assert.ok(maxErr < 1e-4, `signature drifted by ${maxErr}`);
});
