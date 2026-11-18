/**
 * Drum activations by semi-adaptive NMF (after Dittmar & Gärtner 2014):
 * kick / snare / hat / crash templates start from spectral priors and are
 * allowed to adapt to THIS song's kit, while a few free components soak up
 * whatever else leaks through the percussive split (guitar chugs, pluck
 * attacks, consonants).
 */
import type { Spectrogram } from './spectrum';

export type DrumKind = 'kick' | 'snare' | 'hh' | 'crash';
export const DRUMS: DrumKind[] = ['kick', 'snare', 'hh', 'crash'];
export interface NmfOpts {
  /** magnitude compression before NMF */
  power: number;
  /** how strongly drum templates stay anchored to their priors at the end */
  alphaMin: number;
  /** free components that absorb non-drum energy */
  free: number;
}
export const NMF_DEFAULTS: NmfOpts = { power: 0.5, alphaMin: 0.15, free: 4 };

export interface DrumActivations {
  fps: number;
  frames: number;
  act: Record<DrumKind, Float32Array>;
}

function priors(freqs: Float32Array): Float32Array[] {
  const g = (f: number, c: number, s: number) => Math.exp(-((Math.log2(f / c) / s) ** 2) / 2);
  const shapes: ((f: number) => number)[] = [
    (f) => g(f, 62, 0.55) + 0.05 * g(f, 3500, 0.8), // kick: body + beater click
    (f) => 0.45 * g(f, 210, 0.45) + g(f, 2600, 1.15), // snare: shell + wires
    (f) => g(f, 10500, 0.5), // closed/open hat, ride
    (f) => g(f, 5500, 1.05), // crash: broad, lower
  ];
  return shapes.map((fn) => {
    const w = new Float32Array(freqs.length);
    let sum = 0;
    for (let b = 0; b < freqs.length; b++) {
      w[b] = fn(freqs[b]) + 1e-4;
      sum += w[b];
    }
    for (let b = 0; b < w.length; b++) w[b] /= sum;
    return w;
  });
}

/**
 * V: frame-major percussive magnitude (frames × bands).
 * Returns per-drum activation curves, one value per frame.
 */
export function drumActivations(spec: Spectrogram, perc: Float32Array, o: NmfOpts = NMF_DEFAULTS): DrumActivations {
  const { frames, bands, freqs, fps } = spec;
  const { power, alphaMin } = o;
  const K = DRUMS.length + o.free;
  const V = new Float32Array(perc.length);
  let vmax = 0;
  for (let i = 0; i < V.length; i++) {
    V[i] = Math.pow(perc[i], power);
    if (V[i] > vmax) vmax = V[i];
  }
  if (vmax > 0) for (let i = 0; i < V.length; i++) V[i] /= vmax;

  // W: bands × K (band-major), drum columns from priors, free ones pseudo-random
  const pri = priors(freqs);
  const W = new Float32Array(bands * K);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let k = 0; k < K; k++) {
    let sum = 0;
    for (let b = 0; b < bands; b++) {
      const v = k < DRUMS.length ? pri[k][b] : 0.2 + rnd();
      W[b * K + k] = v;
      sum += v;
    }
    for (let b = 0; b < bands; b++) W[b * K + k] /= sum;
  }

  // ── learn templates on the loudest percussive frames ──
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    for (let b = 0; b < bands; b++) e += V[f * bands + b];
    energy[f] = e;
  }
  const order = Array.from({ length: frames }, (_, i) => i).sort((a, b) => energy[b] - energy[a]);
  const learnN = Math.min(4000, Math.max(1, Math.floor(frames * 0.5)));
  const learn = order.slice(0, learnN).sort((a, b) => a - b);
  const sub = new Float32Array(learn.length * bands);
  learn.forEach((f, i) => sub.set(V.subarray(f * bands, (f + 1) * bands), i * bands));
  const Hs = new Float32Array(learn.length * K).fill(0.1);
  const iters = 70;
  for (let it = 0; it < iters; it++) {
    updateH(sub, W, Hs, learn.length, bands, K);
    updateW(sub, W, Hs, learn.length, bands, K);
    // semi-adaptive: pull drum templates back toward their priors, less over time
    const alpha = alphaMin + (1 - alphaMin) * (1 - it / iters) ** 2;
    for (let k = 0; k < DRUMS.length; k++) {
      let sum = 0;
      for (let b = 0; b < bands; b++) sum += W[b * K + k];
      for (let b = 0; b < bands; b++) W[b * K + k] = alpha * pri[k][b] + (1 - alpha) * (W[b * K + k] / sum);
    }
  }

  // ── activations for every frame with the templates fixed ──
  const H = new Float32Array(frames * K).fill(0.1);
  for (let it = 0; it < 40; it++) updateH(V, W, H, frames, bands, K);

  const act = {} as Record<DrumKind, Float32Array>;
  DRUMS.forEach((d, k) => {
    const a = new Float32Array(frames);
    for (let f = 0; f < frames; f++) a[f] = H[f * K + k];
    act[d] = a;
  });
  return { fps, frames, act };
}

/** KL multiplicative update of H (frames × K), V frames × bands, W bands × K */
function updateH(V: Float32Array, W: Float32Array, H: Float32Array, frames: number, bands: number, K: number) {
  const colSum = new Float64Array(K);
  for (let b = 0; b < bands; b++) for (let k = 0; k < K; k++) colSum[k] += W[b * K + k];
  const num = new Float64Array(K);
  for (let f = 0; f < frames; f++) {
    num.fill(0);
    const hrow = f * K;
    for (let b = 0; b < bands; b++) {
      let lam = 1e-9;
      const wrow = b * K;
      for (let k = 0; k < K; k++) lam += W[wrow + k] * H[hrow + k];
      const q = V[f * bands + b] / lam;
      for (let k = 0; k < K; k++) num[k] += W[wrow + k] * q;
    }
    for (let k = 0; k < K; k++) H[hrow + k] *= num[k] / (colSum[k] + 1e-9);
  }
}

function updateW(V: Float32Array, W: Float32Array, H: Float32Array, frames: number, bands: number, K: number) {
  const rowSum = new Float64Array(K);
  for (let f = 0; f < frames; f++) for (let k = 0; k < K; k++) rowSum[k] += H[f * K + k];
  const num = new Float64Array(bands * K);
  for (let f = 0; f < frames; f++) {
    const hrow = f * K;
    for (let b = 0; b < bands; b++) {
      let lam = 1e-9;
      const wrow = b * K;
      for (let k = 0; k < K; k++) lam += W[wrow + k] * H[hrow + k];
      const q = V[f * bands + b] / lam;
      for (let k = 0; k < K; k++) num[wrow + k] += H[hrow + k] * q;
    }
  }
  for (let b = 0; b < bands; b++) for (let k = 0; k < K; k++) W[b * K + k] *= num[b * K + k] / (rowSum[k] + 1e-9);
  // unit-sum columns, scale H to compensate
  for (let k = 0; k < K; k++) {
    let s = 0;
    for (let b = 0; b < bands; b++) s += W[b * K + k];
    if (s <= 0) continue;
    for (let b = 0; b < bands; b++) W[b * K + k] /= s;
    for (let f = 0; f < frames; f++) H[f * K + k] *= s;
  }
}

export interface Hit {
  t: number;
  lane: DrumKind;
  /** peak height relative to this lane's loud hits (≈1 = a normal hit) */
  strength: number;
}

function percentile(a: Float32Array, q: number): number {
  const s = Float32Array.from(a).sort();
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
}

/** Every plausible hit per drum, with a strength; thresholds are applied later. */
export function pickHits(d: DrumActivations, floor = 0.08, fresh = 0.5): Hit[] {
  const out: Hit[] = [];
  for (const lane of DRUMS) {
    const a = d.act[lane];
    const ref = percentile(a, 0.995) || 1;
    const minGap = Math.round(d.fps * 0.045);
    let last = -Infinity;
    for (let f = 2; f < a.length - 2; f++) {
      const v = a[f];
      if (v < floor * ref) continue;
      if (v < a[f - 1] || v < a[f - 2] || v <= a[f + 1] || v <= a[f + 2]) continue;
      // must be a fresh attack, not the tail of the previous one
      let before = v;
      for (let j = Math.max(0, f - 6); j < f; j++) before = Math.min(before, a[j]);
      if (v - before < fresh * v) continue;
      if (f - last < minGap) continue;
      last = f;
      // parabolic peak refinement
      const y0 = a[f - 1];
      const y2 = a[f + 1];
      const den = y0 - 2 * v + y2;
      const dx = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den)) : 0;
      out.push({ t: (f + dx) / d.fps, lane, strength: v / ref });
    }
  }
  return out.sort((x, y) => x.t - y.t);
}
