export type Lane = 'kick' | 'snare' | 'hh' | 'hhOpen' | 'tomLo' | 'tomHi' | 'crash';
export type PathId = 'rudiments' | 'grooves' | 'fills';

export const LANES: Lane[] = ['kick', 'snare', 'hh', 'hhOpen', 'tomLo', 'tomHi', 'crash'];

export const LANE_LABEL: Record<Lane, string> = {
  kick: 'Kick',
  snare: 'Snare',
  hh: 'Hi-Hat',
  hhOpen: 'Open Hat',
  tomLo: 'Low Tom',
  tomHi: 'High Tom',
  crash: 'Crash',
};

/**
 * Does a hit on `hit` play a note on `note`? Each drum plays its own notes,
 * and an open hi-hat also plays a hi-hat note: song charts have one hi-hat
 * (the transcription can't tell open from closed), so opening it where the
 * record does must still count. An open-hat note needs the open hat.
 */
export function plays(hit: Lane, note: Lane): boolean {
  return hit === note || (hit === 'hhOpen' && note === 'hh');
}

/** chart rows, top to bottom: cymbals above, kick below, like drum notation */
export const ROW_ORDER: Lane[] = ['crash', 'hh', 'tomHi', 'snare', 'tomLo', 'kick'];

/**
 * The chart row a drum's notes sit in. The open hat shares the hi-hat's row,
 * drawn hollow, as drum notation writes open and closed hats on one line.
 */
export const ROW_OF: Record<Lane, Lane> = {
  kick: 'kick',
  snare: 'snare',
  hh: 'hh',
  hhOpen: 'hh',
  tomLo: 'tomLo',
  tomHi: 'tomHi',
  crash: 'crash',
};

/** only the rows a lesson or song uses */
export function rowsFor(notes: { lane: Lane }[]): Lane[] {
  const used = new Set(notes.map((n) => ROW_OF[n.lane]));
  const rows = ROW_ORDER.filter((l) => used.has(l));
  return rows.length > 0 ? rows : ROW_ORDER;
}

/** t = beat position from bar 1 beat 1 (beat 0). Drums are hits, so no duration. */
export interface Note {
  t: number;
  lane: Lane;
}

export interface Section {
  start: number;
  end: number;
  name: string;
}

export interface Lesson {
  id: string;
  title: string;
  pathId: PathId;
  difficulty: 1 | 2 | 3 | 4 | 5;
  bpm: number;
  desc: string;
  /** song length in beats (last note + tail fits inside) */
  totalBeats: number;
  countInBeats: number;
  notes: Note[];
  sections: Section[];
}

export interface PathDef {
  id: PathId;
  name: string;
  blurb: string;
  emoji: string;
}
