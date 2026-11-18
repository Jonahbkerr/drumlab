import type { Lane } from './types';

export interface SongChart {
  id: string;
  title: string;
  bpm: number;
  durationSec: number;
  countInBeats: number;
  notes: { t: number; lane: Lane }[];
  sections: { start: number; end: number; name: string }[];
}

export interface SongSettings {
  bpm: number; // 0 = auto-detect
  threshold: number; // onset sensitivity multiplier (0.5–2)
  density: number; // keep this fraction of the strongest onsets (0.2–1)
}

export interface Analysis {
  sampleRate: number;
  hop: number;
  flux: Float32Array; // per-frame spectral flux
  lowFlux: Float32Array; // per-frame flux of the 30–200Hz bands (kick detector)
  bands: Float32Array[]; // per-frame band energies (BAND_COUNT bands)
  times: Float32Array; // per-frame time in seconds
}

const FFT = 2048;
const HOP = 512;
export const BAND_EDGES = [30, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 20000];

export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const arr = await file.arrayBuffer();
  return decodeAudioBytes(arr);
}

export async function decodeAudioBytes(bytes: ArrayBuffer): Promise<AudioBuffer> {
  const OC =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  if (!OC) throw new Error('WebAudio not supported');
  // Decode at a fixed 44.1kHz: analysis timing (onset frames, decay windows)
  // must not depend on the device AudioContext rate (can be 24/48k).
  const ctx = new OC(1, 1, 44100);
  return await ctx.decodeAudioData(bytes.slice(0));
}

export function analyze(buffer: AudioBuffer): Analysis {
  const sr = buffer.sampleRate;
  const len = buffer.length;
  const frames = Math.floor((len - FFT) / HOP);
  const flux = new Float32Array(frames);
  const lowFlux = new Float32Array(frames);
  const times = new Float32Array(frames);
  const bandCount = BAND_EDGES.length - 1;
  const bands: Float32Array[] = Array.from({ length: bandCount }, () => new Float32Array(frames));

  // mono mix
  const mono = new Float32Array(len);
  for (let ch = 0; ch < Math.min(2, buffer.numberOfChannels); ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < len; i++) mono[i] += d[i];
  }

  const windowFn = new Float32Array(FFT);
  for (let i = 0; i < FFT; i++) windowFn[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT);

  // frequency bin edges
  const binHz = sr / FFT;
  const bandBins = BAND_EDGES.map((e) => Math.min(FFT / 2, Math.max(0, Math.floor(e / binHz))));

  const prev = new Float32Array(FFT / 2);
  const cur = new Float32Array(FFT / 2);
  const re = new Float32Array(FFT);
  const im = new Float32Array(FFT);

  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    for (let i = 0; i < FFT; i++) {
      re[i] = mono[off + i] * windowFn[i];
      im[i] = 0;
    }
    fft(re, im);

    let fl = 0;
    for (let k = 0; k < FFT / 2; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      cur[k] = mag;
      const diff = Math.max(0, mag - prev[k]);
      fl += diff;
      // band accumulation
      for (let b = 0; b < bandCount; b++) {
        if (k >= bandBins[b] && k < bandBins[b + 1]) {
          bands[b][f] += mag;
          break;
        }
      }
    }
    flux[f] = fl;
    // kick detector: rise in total low-band (30–200Hz) energy
    const lowNow = bands[0][f] + bands[1][f];
    const lowPrev = f > 0 ? bands[0][f - 1] + bands[1][f - 1] : 0;
    lowFlux[f] = Math.max(0, lowNow - lowPrev);
    times[f] = off / sr + HOP / 2 / sr;
    // copy cur into prev
    for (let k = 0; k < FFT / 2; k++) prev[k] = cur[k];
  }

  return { sampleRate: sr, hop: HOP, flux, lowFlux, bands, times };
}

/** in-place radix-2 FFT (power of two size) */
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  // bit reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curR = 1;
      let curI = 0;
      for (let k = 0; k < len / 2; k++) {
        const uR = re[i + k];
        const uI = im[i + k];
        const vR = re[i + k + len / 2] * curR - im[i + k + len / 2] * curI;
        const vI = re[i + k + len / 2] * curI + im[i + k + len / 2] * curR;
        re[i + k] = uR + vR;
        im[i + k] = uI + vI;
        re[i + k + len / 2] = uR - vR;
        im[i + k + len / 2] = uI - vI;
        const nR = curR * wr - curI * wi;
        curI = curR * wi + curI * wr;
        curR = nR;
      }
    }
  }
}

/** BPM via autocorrelation of the flux envelope with harmonic support (30–240 BPM). */
export function detectBpm(a: Analysis): number | null {
  const n = a.flux.length;
  if (n < 64) return null;
  const fps = a.sampleRate / a.hop; // frames per second
  const minLag = Math.floor(fps * 0.28);
  const maxLag = Math.min(Math.floor(fps * 2.0), n - 1);
  if (maxLag <= minLag) return null;

  // compress + detrend (moving-average baseline)
  const win = Math.max(16, Math.floor(fps * 1.5));
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) env[i] = Math.sqrt(a.flux[i]);
  const centered = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const from = Math.max(0, i - win);
    const to = Math.min(n, i + win);
    let s = 0;
    for (let j = from; j < to; j++) s += env[j];
    centered[i] = Math.max(0, env[i] - s / (to - from));
  }

  const cache = new Map<number, number>();
  const corr = (lag: number): number => {
    if (lag < 1 || lag >= n) return 0;
    const hit = cache.get(lag);
    if (hit !== undefined) return hit;
    let num = 0;
    let e1 = 0;
    let e2 = 0;
    for (let i = 0; i + lag < n; i++) {
      num += centered[i] * centered[i + lag];
      e1 += centered[i] * centered[i];
      e2 += centered[i + lag] * centered[i + lag];
    }
    const v = e1 > 0 && e2 > 0 ? num / Math.sqrt(e1 * e2) : 0;
    cache.set(lag, v);
    return v;
  };

  let best = -Infinity;
  let bestLag = 0;
  // tempo prior: peaks around ~0.5s (120 BPM), penalizes slow harmonic multiples
  const priorCenter = fps * 0.5;
  const priorSigma = fps * 0.45;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const base = corr(lag);
    if (base <= 0) continue;
    // true beat lags have support at half and double (rejects off-beat harmonics)
    const half = Math.floor(lag / 2);
    const double = lag * 2;
    let support = 0;
    if (half >= minLag) support += corr(half) * 0.4;
    if (double < n) support += corr(double) * 0.4;
    const d = (lag - priorCenter) / priorSigma;
    const prior = Math.exp(-(d * d) / 2);
    const score = (base + support) * prior;
    if (score > best) {
      best = score;
      bestLag = lag;
    }
  }
  if (bestLag === 0) return null;
  const bpm = 60 / (bestLag / fps);
  if (bpm < 40 || bpm > 260) return null;
  return Math.round(bpm * 10) / 10;
}

interface Peak {
  f: number;
  t: number;
  flux: number;
  kind: 'kick' | 'other';
}

function localMean(arr: Float32Array, i: number, win: number): number {
  const from = Math.max(0, i - win);
  const to = Math.min(arr.length, i + win);
  let s = 0;
  for (let j = from; j < to; j++) s += arr[j];
  return s / (to - from);
}

function seriesPeaks(
  a: Analysis,
  arr: Float32Array,
  kind: 'kick' | 'other',
  mult: number,
  raw: Peak[],
) {
  const n = arr.length;
  const win = Math.max(12, Math.floor((a.sampleRate / a.hop) * 0.5));
  const minGap = Math.floor((a.sampleRate / a.hop) * 0.08); // 80ms
  for (let i = 1; i < n - 1; i++) {
    const v = arr[i];
    if (v < localMean(arr, i, win) * mult) continue;
    if (v < arr[i - 1] || v <= arr[i + 1]) continue;
    const last = raw[raw.length - 1];
    if (last && i - last.f < minGap) {
      if (v > last.flux) raw[raw.length - 1] = { f: i, t: a.times[i], flux: v, kind };
      continue;
    }
    raw.push({ f: i, t: a.times[i], flux: v, kind });
  }
}

function pickPeaks(a: Analysis, threshold: number, density: number): Peak[] {
  const raw: Peak[] = [];
  seriesPeaks(a, a.flux, 'other', threshold * 1.5, raw);
  // kick series separately: its flux values are smaller, never compete with transients
  const kickRaw: Peak[] = [];
  seriesPeaks(a, a.lowFlux, 'kick', threshold * 1.8, kickRaw);
  // merge kick peaks that don't collide with an existing peak
  const minGap = Math.floor((a.sampleRate / a.hop) * 0.08);
  for (const p of kickRaw) {
    const clash = raw.some((q) => Math.abs(q.f - p.f) < minGap);
    if (!clash) raw.push(p);
  }
  raw.sort((x, y) => x.t - y.t);
  if (density >= 1) return raw;
  // density crops the weakest non-kick peaks; kicks always survive
  const others = raw.filter((p) => p.kind === 'other').sort((x, y) => y.flux - x.flux);
  const keep = new Set<number>();
  const keepN = Math.max(8, Math.floor(others.length * density));
  for (let i = 0; i < keepN && i < others.length; i++) keep.add(others[i].f);
  return raw.filter((p) => p.kind === 'kick' || keep.has(p.f));
}

function bandBinCounts(sampleRate: number): number[] {
  const binHz = sampleRate / FFT;
  return BAND_EDGES.slice(0, -1).map((lo, i) => {
    const a = Math.min(FFT / 2, Math.max(0, Math.floor(lo / binHz)));
    const b = Math.min(FFT / 2, Math.max(0, Math.floor(BAND_EDGES[i + 1] / binHz)));
    return Math.max(1, b - a);
  });
}

function classifyPeaks(a: Analysis, p: Peak): Lane[] {
  // Multi-lane: a hit can be kick+snare+hat together.
  // kick: 30-100Hz band at deep body frame f+5 AND still ringing at f+8
  //       (kicks sustain 200ms+; snare low-frequency pops die within ~90ms)
  // hat:  high bands at f+3 (decayed by f+5)
  // snare: mid bands (400-3200) share of the mid+high spectrum at f+3,
  //        with mid per-bin clearly above the high-band floor
  const b3 = bandsAt(a, p.f + 3);
  const b5 = bandsAt(a, p.f + 5);
  const b8 = bandsAt(a, p.f + 8);
  const bc = bandBinCounts(a.sampleRate);
  const avg = (b: Float32Array, i: number) => b[i] / bc[i];
  const ratio = (b: Float32Array, lo: number, hi: number) => {
    let total = 0;
    let part = 0;
    for (let i = 0; i < b.length; i++) {
      const v = avg(b, i);
      total += v;
      if (i >= lo && i <= hi) part += v;
    }
    return total > 0 ? part / total : 0;
  };
  const out: Lane[] = [];
  // kick
  const kickNow = b5[0] / bc[0];
  const kickLater = b8[0] / bc[0];
  if (ratio(b5, 0, 0) > 0.12 && kickLater > kickNow * 0.25) out.push('kick');
  // hat
  if (ratio(b3, 5, 8) > 0.3) out.push('hh');
  // snare: mid-band crack that decays fast between f+3 and f+5
  // (kick ring harmonics persist; snare cracks halve in ~35ms)
  let mid3 = 0;
  let high3 = 0;
  let mid5 = 0;
  for (let i = 2; i <= 5; i++) {
    mid3 += avg(b3, i);
    mid5 += avg(b5, i);
  }
  for (let i = 6; i <= 8; i++) high3 += avg(b3, i);
  const share = (mid3 + high3) > 0 ? mid3 / (mid3 + high3) : 0;
  const midAvg3 = mid3 / 4;
  const midAvg5 = mid5 / 4;
  if (share > 0.6 && midAvg3 > 1.5 && midAvg5 < midAvg3 * 0.75) out.push('snare');
  if (out.length === 0) {
    out.push(p.kind === 'kick' ? 'kick' : 'snare');
  }
  return out;
}

/** quantize to the 16th-note grid — but never move an onset more than 30ms */
function snap(t: number, grid: number): number {
  const q = Math.round(t / grid) * grid;
  if (Math.abs(q - t) > 0.03) return Math.round(t * 1000) / 1000;
  return Math.round(q * 1000) / 1000;
}

export function generateChart(
  buffer: AudioBuffer,
  settings: SongSettings,
  preAnalysis?: Analysis,
): SongChart {
  const a = preAnalysis ?? analyze(buffer);
  const bpm = settings.bpm > 0 ? settings.bpm : (detectBpm(a) ?? 120);
  const peaks = pickPeaks(a, settings.threshold, settings.density);
  const grid = 60 / bpm / 4;

  interface RawNote {
    t: number;
    lane: Lane;
    flux: number;
  }
  const notes: RawNote[] = [];
  for (const p of peaks) {
    const t = snap(p.t, grid);
    for (const lane of classifyPeaks(a, p)) {
      notes.push({ t, lane, flux: p.flux });
    }
  }
  // dedupe: one note per lane per grid slot (keep strongest)
  notes.sort((x, y) => x.t - y.t || y.flux - x.flux);
  const deduped: RawNote[] = [];
  const lastSlot: Record<string, number> = {};
  for (const note of notes) {
    const key = `${note.t.toFixed(3)}:${note.lane}`;
    if (lastSlot[key] !== undefined) continue;
    lastSlot[key] = deduped.length;
    deduped.push(note);
  }
  // cap simultaneous lanes at 3 (keep strongest flux)
  const byTime = new Map<number, RawNote[]>();
  for (const note of deduped) {
    const arr = byTime.get(note.t) ?? [];
    arr.push(note);
    byTime.set(note.t, arr);
  }
  const final: RawNote[] = [];
  for (const arr of byTime.values()) {
    arr.sort((x, y) => y.flux - x.flux);
    final.push(...arr.slice(0, 3));
  }
  final.sort((x, y) => x.t - y.t);

  const durationSec = buffer.duration;
  const sectionCount = 4;
  const sections = Array.from({ length: sectionCount }, (_, i) => ({
    start: (durationSec * i) / sectionCount,
    end: (durationSec * (i + 1)) / sectionCount,
    name: `Section ${i + 1}`,
  }));

  return {
    id: `song-${Date.now().toString(36)}`,
    title: 'Imported song',
    bpm,
    durationSec,
    countInBeats: 4,
    notes: final.map((n) => ({ t: n.t, lane: n.lane })),
    sections,
  };
}

function bandsAt(a: Analysis, f: number): Float32Array {
  const out = new Float32Array(BAND_EDGES.length - 1);
  const from = Math.max(0, f - 1);
  const to = Math.min(a.flux.length, f + 2);
  for (let b = 0; b < out.length; b++) {
    let s = 0;
    for (let i = from; i < to; i++) s += a.bands[b][i];
    out[b] = s / (to - from);
  }
  return out;
}
