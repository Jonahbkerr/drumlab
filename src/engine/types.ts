export type Lane = 'kick' | 'snare' | 'hh' | 'tomLo' | 'tomHi' | 'crash';
export type PathId = 'rudiments' | 'grooves' | 'fills';

export const LANES: Lane[] = ['kick', 'snare', 'hh', 'tomLo', 'tomHi', 'crash'];

export const LANE_LABEL: Record<Lane, string> = {
  kick: 'Kick',
  snare: 'Snare',
  hh: 'Hi-Hat',
  tomLo: 'Low Tom',
  tomHi: 'High Tom',
  crash: 'Crash',
};

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
