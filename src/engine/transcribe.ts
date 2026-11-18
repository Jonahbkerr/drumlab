/**
 * Song import: decode, analyse (in a worker, see chart/client.ts) and turn
 * the analysis into the SongChart the game plays.
 */
import type { Lane } from './types';
import { arrangeChart, retrack } from './chart/pipeline';
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
  /** difficulty level this chart was built at (absent on single-level charts) */
  level?: number;
}

export interface SongSettings {
  /** 0 = use the detected tempo */
  bpm: number;
  /** 0.5–2; higher keeps quieter hits */
  sensitivity: number;
  /** level shown first when previewing (every level is playable later) */
  level: number;
}

export interface LevelInfo {
  level: number;
  name: string;
  blurb: string;
}

export const LEVELS: LevelInfo[] = [
  { level: 1, name: 'Pulse', blurb: 'Kick and snare on the beat' },
  { level: 2, name: 'Backbeat', blurb: 'Kick and snare on the 8th notes' },
  { level: 3, name: 'Groove', blurb: 'Adds hi-hats and crashes, 8th notes' },
  { level: 4, name: 'Full kit', blurb: 'The real part: 16ths, toms, fills' },
  { level: 5, name: 'Master', blurb: 'Everything, ghost notes included' },
];

/** progress/result id of one level of a saved song */
export const levelId = (songId: string, level: number) => `${songId}:L${level}`;

export function parseLevelId(id: string): { songId: string; level: number | null } {
  const m = /^(.*):L(\d)$/.exec(id);
  return m ? { songId: m[1], level: Number(m[2]) } : { songId: id, level: null };
}

export interface SongLevel extends LevelInfo {
  chart: SongChart;
}

/** the requested level, or the nearest easier one that exists */
export function pickLevel<T extends { level: number }>(levels: T[], level: number): T | undefined {
  let best: T | undefined;
  for (const l of levels) if (l.level <= level) best = l;
  return best ?? levels[0];
}

/**
 * Every playable level of a song, easiest first. A level that adds under 5%
 * more notes than the one below it is dropped (e.g. Master on a song with no
 * ghost notes), so each step is a real step up.
 */
export function songLevels(a: ChartAnalysis, settings: SongSettings, title: string, songId: string): SongLevel[] {
  const tracked = settings.bpm > 0 ? retrack(a, settings.bpm) : a;
  const out: SongLevel[] = [];
  for (const info of LEVELS) {
    const chart = buildSongChart(tracked, { ...settings, level: info.level }, title, levelId(songId, info.level));
    chart.level = info.level;
    const prev = out[out.length - 1];
    if (prev && chart.notes.length < prev.chart.notes.length * 1.05) continue;
    if (chart.notes.length === 0) continue;
    out.push({ ...info, chart });
  }
  return out;
}

export const DEFAULT_SETTINGS: SongSettings = { bpm: 0, sensitivity: 1, level: 3 };

/** settings saved before difficulty levels existed ({ bpm, threshold, density }) */
export function normalizeSettings(raw: unknown): SongSettings {
  const r = (raw ?? {}) as Partial<SongSettings>;
  if (typeof r.level === 'number' && typeof r.sensitivity === 'number') {
    return {
      bpm: typeof r.bpm === 'number' ? r.bpm : 0,
      sensitivity: r.sensitivity,
      level: Math.max(1, Math.min(5, Math.round(r.level))),
    };
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
