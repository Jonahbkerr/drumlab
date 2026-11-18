/**
 * ADTOF Frame_RNN drum transcription model (Zehren, Alunno & Bientinesi,
 * "High-Quality and Reproducible Automatic Drum Transcription from
 * Crowdsourced Data", Signals 2023), PyTorch port by Xavier Riley,
 * exported to ONNX. Weights: CC BY-NC-SA 4.0 — non-commercial use only.
 *
 * Input: adtofSpectrogram() frames. Output: per-frame probabilities for
 * kick, snare, tom, hi-hat, cymbal at 100 fps.
 */
import type { InferenceSession } from 'onnxruntime-web';

export const ADTOF_CLASSES = ['kick', 'snare', 'tom', 'hh', 'crash'] as const;
export type AdtofClass = (typeof ADTOF_CLASSES)[number];
/** published per-class peak thresholds for this model */
export const ADTOF_THRESHOLDS: Record<AdtofClass, number> = { kick: 0.22, snare: 0.24, tom: 0.32, hh: 0.22, crash: 0.3 };

type Ort = typeof import('onnxruntime-web');

export interface AdtofRuntime {
  ort: Ort;
  cnn: InferenceSession;
  rnn: InferenceSession;
}

/** two graphs: the conv front end (chunkable) and the recurrent back end (whole song) */
export async function createAdtof(ort: Ort, cnnModel: Uint8Array, rnnModel: Uint8Array): Promise<AdtofRuntime> {
  const opts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' as const };
  const [cnn, rnn] = await Promise.all([
    ort.InferenceSession.create(cnnModel, opts),
    ort.InferenceSession.create(rnnModel, opts),
  ]);
  return { ort, cnn, rnn };
}

/**
 * Per-frame drum probabilities for a whole song. The conv layers see only
 * ±4 frames, so they run in chunks with an 8-frame overlap (exact, bounded
 * memory, progress); the recurrent layers then run over the full sequence,
 * matching the reference model output.
 */
export async function runAdtof(
  rt: AdtofRuntime,
  spec: { frames: number; bins: number; data: Float32Array },
  onProgress?: (p: number) => void,
): Promise<Float32Array> {
  const { frames, bins, data } = spec;
  const core = 2000;
  const margin = 8;
  let feat: Float32Array | null = null;
  let width = 0;
  for (let s = 0; s < frames; s += core) {
    const e = Math.min(frames, s + core);
    const a = Math.max(0, s - margin);
    const b = Math.min(frames, e + margin);
    const input = new rt.ort.Tensor('float32', data.slice(a * bins, b * bins), [1, b - a, bins, 1]);
    const res = await rt.cnn.run({ spec: input });
    width = res.feat.dims[2];
    if (!feat) feat = new Float32Array(frames * width);
    feat.set((res.feat.data as Float32Array).subarray((s - a) * width, (e - a) * width), s * width);
    input.dispose();
    res.feat.dispose();
    onProgress?.((0.8 * e) / frames);
  }
  if (!feat) return new Float32Array(0);
  const fin = new rt.ort.Tensor('float32', feat, [1, frames, width]);
  const res = await rt.rnn.run({ feat: fin });
  const out = new Float32Array(res.act.data as Float32Array);
  fin.dispose();
  res.act.dispose();
  onProgress?.(1);
  return out;
}

export interface Peak {
  frame: number;
  /** raw probability at the peak */
  value: number;
  /** probability minus its 100 ms moving average (what the threshold applies to) */
  salience: number;
}

/**
 * madmom NotePeakPickingProcessor as used by ADTOF: subtract a 100 ms
 * moving average, local maximum over −20…+10 ms, threshold, merge peaks
 * closer than 20 ms. Returns peaks with their raw probability.
 */
export function pickPeaks(act: Float32Array, cls: number, threshold: number, frames: number): Peak[] {
  const C = ADTOF_CLASSES.length;
  const x = new Float32Array(frames);
  for (let t = 0; t < frames; t++) x[t] = act[t * C + cls];
  const preAvg = 10;
  const postAvg = 1;
  const proc = new Float32Array(frames);
  for (let t = 0; t < frames; t++) {
    let s = 0;
    for (let j = t - preAvg; j <= t + postAvg; j++) s += x[Math.min(frames - 1, Math.max(0, j))];
    proc[t] = Math.max(0, x[t] - s / (preAvg + 1 + postAvg));
  }
  const peaks: number[] = [];
  for (let t = 0; t < frames; t++) {
    if (proc[t] < threshold) continue;
    let isMax = true;
    for (let j = t - 2; j <= t + 1 && isMax; j++) if (proc[Math.min(frames - 1, Math.max(0, j))] > proc[t]) isMax = false;
    if (isMax) peaks.push(t);
  }
  const kept: Peak[] = [];
  let group: number[] = [];
  const flush = () => {
    if (group.length === 0) return;
    const best = group.reduce((p, q) => (proc[q] > proc[p] ? q : p));
    kept.push({ frame: best, value: x[best], salience: proc[best] });
    group = [];
  };
  for (const p of peaks) {
    if (group.length && p - group[group.length - 1] > 2) flush();
    group.push(p);
  }
  flush();
  return kept;
}
