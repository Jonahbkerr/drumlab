/**
 * Log-frequency magnitude spectrogram (frame-major: S[f * bands + b]).
 * 100 frames per second, frame f is centred on sample f * hop, so a frame's
 * time is exactly f / fps.
 */

export interface Spectrogram {
  fps: number;
  frames: number;
  bands: number;
  /** centre frequency of each band in Hz */
  freqs: Float32Array;
  data: Float32Array;
}

const FFT = 2048;

export function spectrogram(samples: Float32Array, sr: number): Spectrogram {
  const hop = Math.round(sr / 100);
  const fps = sr / hop;
  const frames = Math.max(0, Math.floor(samples.length / hop));
  const binHz = sr / FFT;

  // 1/8-octave band edges (30 Hz – 16 kHz), merged so each band owns ≥ 1 bin
  const edges: number[] = [];
  for (let f = 30; f < Math.min(16000, sr / 2); f *= Math.pow(2, 1 / 8)) {
    const bin = Math.max(1, Math.round(f / binHz));
    if (edges.length === 0 || bin > edges[edges.length - 1]) edges.push(bin);
  }
  const bands = edges.length - 1;
  const freqs = new Float32Array(bands);
  for (let b = 0; b < bands; b++) freqs[b] = ((edges[b] + edges[b + 1] - 1) / 2) * binHz;

  const win = new Float32Array(FFT);
  for (let i = 0; i < FFT; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT);
  const { cos, sin, rev } = fftTables(FFT);
  const re = new Float64Array(FFT);
  const im = new Float64Array(FFT);
  const data = new Float32Array(frames * bands);
  const half = FFT / 2;

  for (let f = 0; f < frames; f++) {
    const start = f * hop - half;
    for (let i = 0; i < FFT; i++) {
      const n = start + i;
      re[i] = n >= 0 && n < samples.length ? samples[n] * win[i] : 0;
      im[i] = 0;
    }
    fft(re, im, cos, sin, rev);
    const row = f * bands;
    for (let b = 0; b < bands; b++) {
      let s = 0;
      for (let k = edges[b]; k < edges[b + 1]; k++) s += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      data[row + b] = s;
    }
  }
  return { fps, frames, bands, freqs, data };
}

function fftTables(n: number) {
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((-2 * Math.PI * i) / n);
    sin[i] = Math.sin((-2 * Math.PI * i) / n);
  }
  const rev = new Uint32Array(n);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  return { cos, sin, rev };
}

function fft(re: Float64Array, im: Float64Array, cos: Float64Array, sin: Float64Array, rev: Uint32Array) {
  const n = re.length;
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const halfSize = size >> 1;
    const step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let k = 0; k < halfSize; k++) {
        const wr = cos[k * step];
        const wi = sin[k * step];
        const a = i + k;
        const b = a + halfSize;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/**
 * Harmonic/percussive split by median filtering (Fitzgerald 2010):
 * sustained energy is smooth along time, drum hits are smooth along
 * frequency. Returns the percussive and harmonic spectrograms.
 */
export function hpss(s: Spectrogram, timeWin = 31, freqWin = 9): { perc: Float32Array; harm: Float32Array } {
  const { frames, bands, data } = s;
  const H = new Float32Array(frames * bands);
  const P = new Float32Array(frames * bands);
  const ht = timeWin >> 1;
  const hf = freqWin >> 1;
  const buf = new Float32Array(Math.max(timeWin, freqWin));
  for (let b = 0; b < bands; b++) {
    for (let f = 0; f < frames; f++) {
      let n = 0;
      for (let j = Math.max(0, f - ht); j <= Math.min(frames - 1, f + ht); j++) buf[n++] = data[j * bands + b];
      H[f * bands + b] = median(buf, n);
    }
  }
  for (let f = 0; f < frames; f++) {
    const row = f * bands;
    for (let b = 0; b < bands; b++) {
      let n = 0;
      for (let j = Math.max(0, b - hf); j <= Math.min(bands - 1, b + hf); j++) buf[n++] = data[row + j];
      P[row + b] = median(buf, n);
    }
  }
  const perc = new Float32Array(frames * bands);
  const harm = new Float32Array(frames * bands);
  for (let i = 0; i < perc.length; i++) {
    const p2 = P[i] * P[i];
    const h2 = H[i] * H[i];
    const m = p2 + h2 > 1e-20 ? p2 / (p2 + h2) : 0;
    perc[i] = data[i] * m;
    harm[i] = data[i] * (1 - m);
  }
  return { perc, harm };
}

/** median of the first n values (partially sorts buf) */
function median(buf: Float32Array, n: number): number {
  const k = n >> 1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const pivot = buf[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (buf[i] < pivot) i++;
      while (buf[j] > pivot) j--;
      if (i <= j) {
        const t = buf[i];
        buf[i] = buf[j];
        buf[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  return buf[k];
}
