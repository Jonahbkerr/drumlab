/**
 * Audio → drum chart.
 *
 *   analyzeSamples()  heavy, once per song: spectrogram, harmonic/percussive
 *                     split, per-drum activations, hits, beat grid
 *   arrangeChart()    cheap, on every difficulty/sensitivity change
 */
import { BeatGrid, arrange } from './arrange';
import type { ArrangeOpts, ChartNote } from './arrange';
import { estimatePeriod, onsetNovelty, trackBeats } from './beats';
import { NMF_DEFAULTS, drumActivations, pickHits } from './drums';
import type { Hit, NmfOpts } from './drums';
import { hpss, spectrogram } from './spectrum';

export interface ChartAnalysis {
  duration: number;
  /** beat times in seconds */
  beats: number[];
  period: number;
  hits: Hit[];
}

export interface ArrangedChart {
  bpm: number;
  beats: number[];
  notes: ChartNote[];
}

/** measured on the bench: activation peaks trail the true attack slightly */
const ONSET_SHIFT = 0;

export interface AnalyzeOpts {
  bpm?: number;
  nmf?: Partial<NmfOpts>;
  fresh?: number;
}

export function analyzeSamples(samples: Float32Array, sr: number, opts: AnalyzeOpts = {}): ChartAnalysis {
  const spec = spectrogram(samples, sr);
  const { perc } = hpss(spec);
  const drums = drumActivations(spec, perc, { ...NMF_DEFAULTS, ...opts.nmf });
  const hits = pickHits(drums, 0.08, opts.fresh ?? 0.5).map((h) => ({ ...h, t: h.t + ONSET_SHIFT }));
  const nov = onsetNovelty(spec, perc);
  const periodFrames = opts.bpm && opts.bpm > 0 ? (spec.fps * 60) / opts.bpm : estimatePeriod(nov, spec.fps);
  const beats = trackBeats(nov, periodFrames).map((f) => f / spec.fps);
  return { duration: samples.length / sr, beats, period: periodFrames / spec.fps, hits };
}

export function arrangeChart(a: ChartAnalysis, opts: ArrangeOpts): ArrangedChart {
  const grid = new BeatGrid(a.beats, a.period);
  const notes = arrange(a.hits, grid, opts);
  return { bpm: Math.round((600 / grid.period)) / 10, beats: a.beats, notes };
}

export function transcribeSamples(samples: Float32Array, sr: number, opts: ArrangeOpts & AnalyzeOpts): ArrangedChart {
  return arrangeChart(analyzeSamples(samples, sr, opts), opts);
}
