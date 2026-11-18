/**
 * Input features for the ADTOF drum model, matching its training pipeline
 * (madmom-style log-filtered spectrogram): 44.1 kHz mono, 2048-pt symmetric
 * Hann, hop 441 (100 fps), centred frames with zero padding, 12 triangular
 * bands per octave from 20 Hz to 20 kHz (84 bands), log10(1 + x).
 */

export const ADTOF_SR = 44100;
export const ADTOF_FPS = 100;
const N_FFT = 2048;
const HOP = 441;

let cachedBank: { bins: number; rows: { start: number; w: Float32Array }[]; centers: number[] } | null = null;

function filterbank() {
  if (cachedBank) return cachedBank;
  const nBins = N_FFT / 2;
  const fftFreq = (k: number) => (k * ADTOF_SR) / N_FFT;
  const targets: number[] = [];
  const factor = Math.pow(2, 1 / 12);
  for (let f = 20; f <= 20000 * (1 + 1e-12); f *= factor) targets.push(f);
  const raw = targets.map((f) => {
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < nBins; k++) {
      const d = Math.abs(fftFreq(k) - f);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    return best;
  });
  const bins: number[] = [];
  for (const b of raw) if (bins.length === 0 || b > bins[bins.length - 1]) bins.push(b);
  const rows: { start: number; w: Float32Array }[] = [];
  const centers: number[] = [];
  for (let i = 0; i < bins.length - 2; i++) {
    centers.push(fftFreq(bins[i + 1]));
    const left = bins[i];
    const center = bins[i + 1];
    const right = bins[i + 2];
    const w = new Float32Array(right - left + 1);
    if (right - left < 2) {
      w[0] = 1;
    } else {
      for (let b = left; b < center; b++) w[b - left] = (b - left) / (center - left);
      w[center - left] = 1;
      for (let b = center + 1; b < Math.min(right, nBins); b++) w[b - left] = (right - b) / (right - center);
    }
    let sum = 0;
    for (const v of w) sum += v;
    if (sum > 0) for (let j = 0; j < w.length; j++) w[j] /= sum;
    rows.push({ start: left, w });
  }
  cachedBank = { bins: rows.length, rows, centers };
  return cachedBank;
}

export function adtofBins(): number {
  return filterbank().bins;
}

/** centre frequency (Hz) of each of the 84 bands */
export function adtofBandFreqs(): number[] {
  return filterbank().centers;
}

/** frames × 84, frame-major. samples must be 44.1 kHz mono. */
export function adtofSpectrogram(samples: Float32Array, onProgress?: (p: number) => void): { frames: number; bins: number; data: Float32Array } {
  const bank = filterbank();
  const frames = 1 + Math.floor(samples.length / HOP);
  const data = new Float32Array(frames * bank.bins);
  const win = new Float64Array(N_FFT);
  for (let i = 0; i < N_FFT; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N_FFT - 1));
  const re = new Float64Array(N_FFT);
  const im = new Float64Array(N_FFT);
  const mag = new Float64Array(N_FFT / 2);
  const { cos, sin, rev } = tables();
  for (let t = 0; t < frames; t++) {
    const start = t * HOP - N_FFT / 2;
    for (let i = 0; i < N_FFT; i++) {
      const n = start + i;
      re[i] = n >= 0 && n < samples.length ? samples[n] * win[i] : 0;
      im[i] = 0;
    }
    fft(re, im, cos, sin, rev);
    for (let k = 0; k < N_FFT / 2; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    const row = t * bank.bins;
    for (let r = 0; r < bank.bins; r++) {
      const { start: s0, w } = bank.rows[r];
      let acc = 0;
      for (let j = 0; j < w.length; j++) if (w[j] !== 0) acc += w[j] * mag[s0 + j];
      data[row + r] = Math.log10(1 + acc);
    }
    if (onProgress && t % 2000 === 0) onProgress(t / frames);
  }
  return { frames, bins: bank.bins, data };
}

let cachedTables: { cos: Float64Array; sin: Float64Array; rev: Uint32Array } | null = null;
function tables() {
  if (cachedTables) return cachedTables;
  const n = N_FFT;
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
  cachedTables = { cos, sin, rev };
  return cachedTables;
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
    const half = size >> 1;
    const step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step];
        const wi = sin[k * step];
        const a = i + k;
        const b = a + half;
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
