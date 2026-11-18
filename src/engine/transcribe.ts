/**
 * Song import: decode, analyse (in a worker, see chart/client.ts) and turn
 * the analysis into the SongChart the game plays.
 */
import type { Lane } from './types';
import { arrangeChart } from './chart/pipeline';
import type { ChartAnalysis } from './chart/pipeline';

export interface SongChart {
  id: string;
  title: string;
  bpm: number;
  durationSec: number;
  countInBeats: number;
  notes: { t: number; lane: Lane }[];
  sections: { start: number; end: number; name: string }[];
  /** tracked beat times (s). Absent on charts made before beat tracking. */
  beats?: number[];
  /** index into beats of the first bar start */
  downbeat?: number;
}

export interface SongSettings {
  /** 0 = use the detected tempo */
  bpm: number;
  /** 0.5–2; higher keeps quieter hits */
  sensitivity: number;
  /** 1 Easy · 2 Medium · 3 Hard · 4 Full */
  level: number;
}

export const LEVELS: { level: number; name: string; blurb: string }[] = [
  { level: 1, name: 'Easy', blurb: 'Kick and snare on the 8ths' },
  { level: 2, name: 'Medium', blurb: 'Adds hats and cymbals, 8ths only' },
  { level: 3, name: 'Hard', blurb: 'The full groove, no ghost notes' },
  { level: 4, name: 'Full', blurb: 'Everything the drummer played' },
];

export const DEFAULT_SETTINGS: SongSettings = { bpm: 0, sensitivity: 1, level: 3 };

/** settings saved before difficulty levels existed ({ bpm, threshold, density }) */
export function normalizeSettings(raw: unknown): SongSettings {
  const r = (raw ?? {}) as Partial<SongSettings>;
  if (typeof r.level === 'number' && typeof r.sensitivity === 'number') {
    return { bpm: typeof r.bpm === 'number' ? r.bpm : 0, sensitivity: r.sensitivity, level: r.level };
  }
  return { ...DEFAULT_SETTINGS };
}

export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  return decodeAudioBytes(await file.arrayBuffer());
}

export async function decodeAudioBytes(bytes: ArrayBuffer): Promise<AudioBuffer> {
  const OC =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!OC) throw new Error('WebAudio not supported');
  // Decode at a fixed 44.1 kHz: the drum model is trained at that rate, and
  // analysis must not depend on the device AudioContext rate (24/48 kHz).
  const ctx = new OC(1, 1, 44100);
  return await ctx.decodeAudioData(bytes.slice(0));
}

/** mono mix of a decoded (44.1 kHz) buffer */
export function monoSamples(buffer: AudioBuffer): Float32Array {
  const n = buffer.length;
  const out = new Float32Array(n);
  const ch = Math.max(1, Math.min(2, buffer.numberOfChannels));
  for (let c = 0; c < ch; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += d[i] / ch;
  }
  return out;
}

const BARS_PER_SECTION = 8;

export function buildSongChart(a: ChartAnalysis, settings: SongSettings, title: string, id?: string): SongChart {
  const c = arrangeChart(a, { level: settings.level, sensitivity: settings.sensitivity });
  const beats = c.beats;
  const sections: SongChart['sections'] = [];
  const barBeats = 4 * BARS_PER_SECTION;
  if (beats.length > barBeats) {
    let start = 0;
    let bar = 1;
    for (let i = c.downbeat + barBeats; i < beats.length; i += barBeats) {
      const end = beats[i] - 0.05;
      sections.push({ start, end, name: `Bars ${bar}–${bar + BARS_PER_SECTION - 1}` });
      start = end;
      bar += BARS_PER_SECTION;
    }
    sections.push({ start, end: a.duration, name: `Bars ${bar}–end` });
  } else {
    sections.push({ start: 0, end: a.duration, name: 'Whole song' });
  }
  return {
    id: id ?? `song-${Date.now().toString(36)}`,
    title,
    bpm: c.bpm,
    durationSec: a.duration,
    countInBeats: 4,
    notes: c.notes.map((n) => ({ t: n.t, lane: n.lane })),
    sections,
    beats,
    downbeat: c.downbeat,
  };
}
