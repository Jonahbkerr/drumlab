/**
 * Drum stem separation with Demucs v4 (htdemucs_ft drums specialist, Meta,
 * MIT; ONNX export for onnxruntime-web by monteslu/htdemucs-ft-webgpu).
 *
 * The ONNX graph holds the network only: the spectrogram and its inverse are
 * done here, matching Demucs' own `_spec` / `_ispec` (torch.stft with
 * n_fft 4096, hop 1024, periodic Hann window, normalized, centered, reflect
 * padding). Songs are processed in 7.8 s segments overlapping by a quarter,
 * cross-faded with Demucs' triangular weights, as `apply_model` does.
 *
 *   inputs  mix [1, 2, 343980]          stereo segment
 *           mag [1, 4, 2048, 336]       its spectrogram, complex as channels
 *   outputs x   [1, 4, 4, 2048, 336]    per source: spectrogram, complex as channels
 *           xt  [1, 4, 2, 343980]       per source: time-branch waveform
 * Source 0 is the drums; the stem is istft(x[0]) + xt[0].
 */
import type * as Ort from 'onnxruntime-web';

export const DEMUCS_SR = 44100;
const NFFT = 4096;
const HOP = 1024;
/** samples per segment (7.8 s, the length the model was trained on) */
export const SEGMENT = 343980;
const BINS = NFFT / 2;
const FRAMES = Math.ceil(SEGMENT / HOP); // 336
const PAD = (HOP / 2) * 3;
const DRUMS = 0;

type OrtModule = typeof Ort;

// ── FFT (radix-2, complex, in place) ──
const LOG2 = Math.log2(NFFT);
const REV = new Uint32Array(NFFT);
for (let i = 0; i < NFFT; i++) {
  let r = 0;
  for (let b = 0; b < LOG2; b++) r |= ((i >> b) & 1) << (LOG2 - 1 - b);
  REV[i] = r;
}
const COS = new Float64Array(NFFT / 2);
const SIN = new Float64Array(NFFT / 2);
for (let i = 0; i < NFFT / 2; i++) {
  COS[i] = Math.cos((2 * Math.PI * i) / NFFT);
  SIN[i] = -Math.sin((2 * Math.PI * i) / NFFT);
}

/** forward DFT, X[k] = sum x[n] e^(-2 pi i k n / N), unnormalized */
function fft(re: Float64Array, im: Float64Array) {
  for (let i = 0; i < NFFT; i++) {
    const j = REV[i];
    if (j > i) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let size = 2; size <= NFFT; size *= 2) {
    const half = size / 2;
    const step = NFFT / size;
    for (let start = 0; start < NFFT; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = COS[k * step];
        const wi = SIN[k * step];
        const a = start + k;
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

/** periodic Hann window (torch.hann_window default) */
const WIN = Float64Array.from({ length: NFFT }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / NFFT));

/** torch 'reflect' padding: the edge sample is not repeated */
function reflectPad(x: Float32Array, left: number, right: number): Float32Array {
  const n = x.length;
  const out = new Float32Array(n + left + right);
  for (let i = 0; i < left; i++) out[i] = x[left - i];
  out.set(x, left);
  for (let k = 0; k < right; k++) out[left + n + k] = x[n - 2 - k];
  return out;
}

/**
 * Demucs `_spec` of one channel of a full segment: [BINS][FRAMES] real and
 * imaginary parts, written into `re` / `im` at `offset`.
 */
export function spec(x: Float32Array, re: Float32Array, im: Float32Array, offset = 0) {
  const xp = reflectPad(x, PAD, PAD + FRAMES * HOP - x.length);
  const xc = reflectPad(xp, NFFT / 2, NFFT / 2); // torch.stft center=True
  const fr = new Float64Array(NFFT);
  const fi = new Float64Array(NFFT);
  const norm = 1 / Math.sqrt(NFFT);
  for (let f = 0; f < FRAMES; f++) {
    const start = (f + 2) * HOP; // Demucs drops the first two frames
    for (let n = 0; n < NFFT; n++) {
      fr[n] = xc[start + n] * WIN[n];
      fi[n] = 0;
    }
    fft(fr, fi);
    for (let b = 0; b < BINS; b++) {
      re[offset + b * FRAMES + f] = fr[b] * norm;
      im[offset + b * FRAMES + f] = fi[b] * norm;
    }
  }
}

/** Demucs `_ispec`: [BINS][FRAMES] spectrogram back to SEGMENT samples */
export function ispec(re: Float32Array, im: Float32Array, reOff: number, imOff: number): Float32Array {
  const frames = FRAMES + 4; // two empty frames each side
  const full = new Float64Array(NFFT + HOP * (frames - 1));
  const wsum = new Float64Array(full.length);
  const fr = new Float64Array(NFFT);
  const fi = new Float64Array(NFFT);
  const norm = 1 / Math.sqrt(NFFT);
  for (let j = 0; j < frames; j++) {
    const f = j - 2;
    fr.fill(0);
    fi.fill(0);
    if (f >= 0 && f < FRAMES) {
      // Hermitian spectrum; bin N/2 is the zero Demucs pads in
      for (let b = 0; b < BINS; b++) {
        fr[b] = re[reOff + b * FRAMES + f];
        fi[b] = -im[imOff + b * FRAMES + f]; // conjugate: ifft(X) = conj(fft(conj(X)))
      }
      for (let b = 1; b < BINS; b++) {
        fr[NFFT - b] = fr[b];
        fi[NFFT - b] = -fi[b];
      }
      fft(fr, fi);
    }
    const at = j * HOP;
    for (let n = 0; n < NFFT; n++) {
      full[at + n] += fr[n] * norm * WIN[n];
      wsum[at + n] += WIN[n] * WIN[n];
    }
  }
  // center=True drops N/2 at the start; Demucs then crops its own padding
  const out = new Float32Array(SEGMENT);
  for (let n = 0; n < SEGMENT; n++) {
    const i = n + NFFT / 2 + PAD;
    out[n] = wsum[i] > 1e-11 ? full[i] / wsum[i] : 0;
  }
  return out;
}

export interface DemucsRuntime {
  session: Ort.InferenceSession;
  ort: OrtModule;
  device: 'webgpu' | 'wasm';
}

type Providers = Ort.InferenceSession.SessionOptions['executionProviders'];

export async function createDemucs(ort: OrtModule, model: Uint8Array | ArrayBuffer, providers: Providers = ['wasm']): Promise<DemucsRuntime> {
  const bytes = model instanceof Uint8Array ? model : new Uint8Array(model);
  // severity 3 = errors only: the graph has fp16 nodes the CPU cannot constant-fold, which is harmless
  const session = await ort.InferenceSession.create(bytes, { executionProviders: providers, logSeverityLevel: 3 });
  const gpu = providers?.some((p) => (typeof p === 'string' ? p : p.name) === 'webgpu');
  return { session, ort, device: gpu ? 'webgpu' : 'wasm' };
}

/** run one segment; returns the left-channel drums (spectrogram + time branch) */
async function drumsOfSegment(rt: DemucsRuntime, mix: Float32Array): Promise<Float32Array> {
  const plane = BINS * FRAMES;
  const mag = new Float32Array(4 * plane);
  spec(mix.subarray(0, SEGMENT), mag.subarray(0, plane), mag.subarray(plane, 2 * plane));
  spec(mix.subarray(SEGMENT), mag.subarray(2 * plane, 3 * plane), mag.subarray(3 * plane, 4 * plane));
  const res = await rt.session.run({
    mix: new rt.ort.Tensor('float32', mix, [1, 2, SEGMENT]),
    mag: new rt.ort.Tensor('float32', mag, [1, 4, BINS, FRAMES]),
  });
  const x = res.x.data as Float32Array;
  const xt = res.xt.data as Float32Array;
  const d = ispec(x, x, 0, plane);
  for (let i = 0; i < SEGMENT; i++) d[i] += xt[i];
  return d;
}

/** a fixed synthetic test segment: kick thumps, snare noise bursts, a chord */
export function testMix(): Float32Array {
  const mix = new Float32Array(2 * SEGMENT);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < SEGMENT; i++) {
    const t = i / DEMUCS_SR;
    const beat = t % 0.5;
    const kick = Math.sin(2 * Math.PI * 55 * beat) * Math.exp(-beat * 18);
    const sb = (t + 0.25) % 0.5;
    const snare = rnd() * Math.exp(-sb * 30) * 0.5;
    const chord = (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277 * t) + Math.sin(2 * Math.PI * 330 * t)) * 0.08;
    mix[i] = kick + snare + chord;
    mix[SEGMENT + i] = kick + snare * 0.8 + chord;
  }
  return mix;
}

/** every 64th sample of a drum output, away from the segment edges */
export function signature(drums: Float32Array): Float32Array {
  const out = new Float32Array(Math.floor((SEGMENT - 8192) / 64));
  for (let k = 0; k < out.length; k++) out[k] = drums[4096 + k * 64];
  return out;
}

export async function testSignature(rt: DemucsRuntime): Promise<Float32Array> {
  return signature(await drumsOfSegment(rt, testMix()));
}

/**
 * Does a (GPU) runtime give the CPU's answer? Runs the test segment and
 * correlates it with the CPU result, stored ahead of time (demucs-check.ts),
 * so the check costs one GPU run instead of a slow CPU run too. GPUs and
 * drivers differ, and fp16 errors here are silent, so always check.
 */
export async function matchesCpu(rt: DemucsRuntime, cpuSignature: Float32Array): Promise<{ ok: boolean; corr: number }> {
  const a = await testSignature(rt);
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i])) return { ok: false, corr: NaN };
    ab += a[i] * cpuSignature[i];
    aa += a[i] * a[i];
    bb += cpuSignature[i] * cpuSignature[i];
  }
  const corr = ab / Math.sqrt(aa * bb || 1);
  return { ok: corr > 0.995, corr };
}

/** Demucs' cross-fade weight for one segment: a triangle peaking mid-segment */
const WEIGHT = (() => {
  const w = new Float32Array(SEGMENT);
  const half = Math.floor(SEGMENT / 2);
  for (let i = 0; i < SEGMENT; i++) w[i] = i < half ? i + 1 : SEGMENT - i;
  const max = half;
  for (let i = 0; i < SEGMENT; i++) w[i] /= max;
  return w;
})();

/**
 * Separate the drums from a stereo song at 44.1 kHz. Returns the mono drum
 * stem, same length. `onProgress` gets 0..1.
 */
export async function separateDrums(
  rt: DemucsRuntime,
  left: Float32Array,
  right: Float32Array,
  onProgress?: (p: number) => void,
): Promise<Float32Array> {
  const { ort, session } = rt;
  const length = left.length;
  // Demucs normalizes the whole track first (separate.py)
  let mean = 0;
  for (let i = 0; i < length; i++) mean += (left[i] + right[i]) / 2;
  mean /= length;
  let v = 0;
  for (let i = 0; i < length; i++) v += ((left[i] + right[i]) / 2 - mean) ** 2;
  const std = Math.sqrt(v / Math.max(1, length - 1)) || 1;

  const outL = new Float32Array(length);
  const outR = new Float32Array(length);
  const wsum = new Float32Array(length);
  const stride = Math.floor(0.75 * SEGMENT);
  const offsets: number[] = [];
  for (let o = 0; o < length; o += stride) offsets.push(o);

  const mix = new Float32Array(2 * SEGMENT);
  const mag = new Float32Array(4 * BINS * FRAMES);
  const plane = BINS * FRAMES;
  for (let k = 0; k < offsets.length; k++) {
    const off = offsets[k];
    const n = Math.min(SEGMENT, length - off);
    mix.fill(0);
    for (let i = 0; i < n; i++) {
      mix[i] = (left[off + i] - mean) / std;
      mix[SEGMENT + i] = (right[off + i] - mean) / std;
    }
    // complex as channels: L re, L im, R re, R im
    spec(mix.subarray(0, SEGMENT), mag.subarray(0, plane), mag.subarray(plane, 2 * plane));
    spec(mix.subarray(SEGMENT), mag.subarray(2 * plane, 3 * plane), mag.subarray(3 * plane, 4 * plane));
    const res = await session.run({
      mix: new ort.Tensor('float32', mix, [1, 2, SEGMENT]),
      mag: new ort.Tensor('float32', mag, [1, 4, BINS, FRAMES]),
    });
    const x = res.x.data as Float32Array;
    const xt = res.xt.data as Float32Array;
    const xs = DRUMS * 4 * plane; // drums: 4 planes (L re, L im, R re, R im)
    const dl = ispec(x, x, xs, xs + plane);
    const dr = ispec(x, x, xs + 2 * plane, xs + 3 * plane);
    const ts = DRUMS * 2 * SEGMENT;
    for (let i = 0; i < n; i++) {
      const w = WEIGHT[i];
      outL[off + i] += w * (dl[i] + xt[ts + i]);
      outR[off + i] += w * (dr[i] + xt[ts + SEGMENT + i]);
      wsum[off + i] += w;
    }
    onProgress?.((k + 1) / offsets.length);
  }
  const mono = new Float32Array(length);
  for (let i = 0; i < length; i++) mono[i] = (((outL[i] + outR[i]) / 2) * std) / (wsum[i] || 1);
  return mono;
}
