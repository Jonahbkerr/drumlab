/**
 * Audio → drum chart.
 *
 *   analyzeSamples()  heavy, once per song: ADTOF drum model, hit peaks,
 *                     beat tracking
 *   arrangeChart()    cheap, on every difficulty/sensitivity change
 */
import type { Lane } from '../types';
import { ADTOF_CLASSES, ADTOF_THRESHOLDS, pickPeaks, runAdtof } from './adtof';
import type { AdtofRuntime } from './adtof';
import { ADTOF_FPS, adtofBandFreqs, adtofSpectrogram } from './adtofSpec';
import { BeatGrid, arrange } from './arrange';
import type { ArrangeOpts, ChartNote, Hit } from './arrange';
import { estimatePeriod, onsetNovelty, trackBeats } from './beats';

export interface ChartAnalysis {
  duration: number;
  /** beat times in seconds */
  beats: number[];
  /** beat period in seconds */
  period: number;
  /** index into beats of the first bar start */
  downbeat: number;
  /** every candidate hit; arrangeChart() applies thresholds */
  hits: Hit[];
  /** onset strength per frame, kept so a tempo override can re-track instantly */
  novelty: Float32Array;
}

export interface ArrangedChart {
  bpm: number;
  beats: number[];
  downbeat: number;
  notes: ChartNote[];
}

export interface AnalyzeOpts {
  /** force a tempo instead of detecting it */
  bpm?: number;
}

/** candidates are kept down to this share of each class threshold */
const CANDIDATE_FLOOR = 0.4;

export async function analyzeSamples(
  samples: Float32Array,
  rt: AdtofRuntime,
  opts: AnalyzeOpts = {},
  onProgress?: (stage: string, p: number) => void,
): Promise<ChartAnalysis> {
  const spec = adtofSpectrogram(samples, (p) => onProgress?.('Listening', p));
  const act = await runAdtof(rt, spec, (p) => onProgress?.('Finding drums', p));
  const C = ADTOF_CLASSES.length;
  const hits: Hit[] = [];
  const toms: { hit: Hit; frame: number }[] = [];
  ADTOF_CLASSES.forEach((cls, c) => {
    const need = ADTOF_THRESHOLDS[cls];
    for (const p of pickPeaks(act, c, need * CANDIDATE_FLOOR, spec.frames)) {
      const lane: Lane = cls === 'tom' ? 'tomLo' : cls;
      const hit: Hit = { t: p.frame / ADTOF_FPS, lane, salience: p.salience, prob: p.value, need };
      hits.push(hit);
      if (cls === 'tom') toms.push({ hit, frame: p.frame });
    }
  });
  splitToms(toms, spec);
  hits.sort((a, b) => a.t - b.t);

  onProgress?.('Following the beat', 0);
  const novelty = onsetNovelty(act, C, [1, 1, 0.5, 0.6, 0.5], spec, ADTOF_FPS);
  const base = { duration: samples.length / 44100, hits, novelty };
  const out = retrack(base, opts.bpm ?? 0);
  onProgress?.('Following the beat', 1);
  return out;
}

/** (re)run beat tracking, optionally forcing a tempo; cheap */
export function retrack(a: Pick<ChartAnalysis, 'duration' | 'hits' | 'novelty'>, bpm: number): ChartAnalysis {
  const periodFrames = bpm > 0 ? (ADTOF_FPS * 60) / bpm : estimatePeriod(a.novelty, ADTOF_FPS);
  const beats = trackBeats(a.novelty, periodFrames).map((f) => f / ADTOF_FPS);
  return { ...a, beats, period: periodFrames / ADTOF_FPS, downbeat: findDownbeat(beats, a.hits) };
}

/**
 * Which of the first four beats starts a bar (4/4): bars open with kick
 * and crash, the backbeat snare lands on 2 and 4.
 */
export function findDownbeat(beats: number[], hits: Hit[]): number {
  if (beats.length < 8) return 0;
  const near = (t: number, lane: Lane) => {
    let best = 0;
    for (const h of hits) {
      if (h.t < t - 0.06) continue;
      if (h.t > t + 0.06) break;
      if (h.lane === lane && h.salience >= h.need) best = Math.max(best, h.salience);
    }
    return best;
  };
  const per = beats.map((t) => ({ kick: near(t, 'kick'), snare: near(t, 'snare'), crash: near(t, 'crash') }));
  let bestPhase = 0;
  let bestScore = -Infinity;
  for (let phase = 0; phase < 4; phase++) {
    let score = 0;
    per.forEach((b, i) => {
      const pos = (((i - phase) % 4) + 4) % 4;
      if (pos === 0) score += b.kick + 1.5 * b.crash - 0.5 * b.snare;
      else if (pos === 2) score += 0.5 * b.kick - 0.5 * b.snare;
      else score += b.snare;
    });
    if (score > bestScore) {
      bestScore = score;
      bestPhase = phase;
    }
  }
  return bestPhase;
}

/**
 * The model has one tom class; split into high/low by where the energy
 * sits in 60–500 Hz just after the hit, relative to this song's toms.
 */
function splitToms(toms: { hit: Hit; frame: number }[], spec: { frames: number; bins: number; data: Float32Array }) {
  if (toms.length === 0) return;
  const freqs = adtofBandFreqs();
  const band = freqs.map((f, b) => (f >= 60 && f <= 500 ? b : -1)).filter((b) => b >= 0);
  const centroid = (frame: number) => {
    const f = Math.min(spec.frames - 1, frame + 2);
    let w = 0;
    let s = 0;
    for (const b of band) {
      const v = spec.data[f * spec.bins + b];
      w += v;
      s += v * b;
    }
    return w > 0 ? s / w : 0;
  };
  const cs = toms.map((t) => centroid(t.frame));
  const sorted = [...cs].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.1)];
  const hi = sorted[Math.floor(sorted.length * 0.9)];
  // one drum (or too few to tell): all on the high tom lane
  if (toms.length < 4 || hi - lo < 1.5) {
    for (const t of toms) t.hit.lane = 'tomHi';
    return;
  }
  const mid = (lo + hi) / 2;
  toms.forEach((t, i) => (t.hit.lane = cs[i] >= mid ? 'tomHi' : 'tomLo'));
}

export function arrangeChart(a: ChartAnalysis, opts: ArrangeOpts): ArrangedChart {
  const grid = new BeatGrid(a.beats, a.period);
  const notes = arrange(a.hits, grid, opts);
  return { bpm: Math.round(600 / grid.period) / 10, beats: a.beats, downbeat: a.downbeat, notes };
}
