import type { Lesson, Lane, Note, PathDef } from '../engine/types';

export const PATHS: PathDef[] = [
  { id: 'rudiments', name: 'Rudiments', blurb: 'Stick control basics. Pad, table, or kit — any surface works.', emoji: '🥁' },
  { id: 'grooves', name: 'Grooves', blurb: 'Kit beats from rock to trap. Kick, snare, hats.', emoji: '🎵' },
  { id: 'fills', name: 'Fills', blurb: 'Around-the-kit moves, tom cascades, crashes.', emoji: '🔥' },
];

const n = (lane: Lane, t: number): Note => ({ lane, t });
const seq = (lane: Lane, from: number, to: number, step: number): Note[] => {
  const out: Note[] = [];
  for (let t = from; t < to - 1e-9; t += step) out.push(n(lane, Math.round(t * 1000) / 1000));
  return out;
};

/** kick on every beat, snare backbeat, hats on eighths — classic rock beat */
function backbeat(bars: number, startBeat = 0): Note[] {
  const beats = bars * 4;
  const out: Note[] = [];
  for (let b = 0; b < beats; b++) {
    out.push(n('kick', startBeat + b));
    out.push(n('hh', startBeat + b));
    out.push(n('hh', startBeat + b + 0.5));
  }
  for (let b = 1; b < beats; b += 2) out.push(n('snare', startBeat + b + 1)); // beats 2 & 4
  return out;
}

const lessons: Lesson[] = [
  {
    id: 'rud-ss',
    title: 'Single Strokes',
    pathId: 'rudiments',
    difficulty: 1,
    bpm: 70,
    desc: 'The foundation of everything. Alternate steady hits on the snare — quarters first, then eighths.',
    totalBeats: 32,
    countInBeats: 4,
    notes: [
      ...seq('snare', 0, 8, 1),
      ...seq('snare', 8, 24, 0.5),
      ...seq('snare', 24, 32, 1),
    ],
    sections: [
      { start: 0, end: 8, name: 'Quarters' },
      { start: 8, end: 24, name: 'Eighths' },
      { start: 24, end: 32, name: 'Quarters' },
    ],
  },
  {
    id: 'rud-ds',
    title: 'Double Strokes',
    pathId: 'rudiments',
    difficulty: 2,
    bpm: 60,
    desc: 'Two hits per hand, RR LL RR LL. Builds control and rebound.',
    totalBeats: 24,
    countInBeats: 4,
    notes: [
      ...seq('snare', 0, 8, 0.5),
      ...seq('snare', 8, 16, 0.25),
      ...seq('snare', 16, 24, 0.5),
    ],
    sections: [
      { start: 0, end: 8, name: 'Eighths (warm-up)' },
      { start: 8, end: 16, name: 'Sixteenth doubles' },
      { start: 16, end: 24, name: 'Eighths (out)' },
    ],
  },
  {
    id: 'rud-para',
    title: 'Paradiddles',
    pathId: 'rudiments',
    difficulty: 3,
    bpm: 65,
    desc: 'RLRR LRLL — the pattern every drummer lives in. Steady sixteenths, stay relaxed.',
    totalBeats: 16,
    countInBeats: 4,
    notes: seq('snare', 0, 16, 0.25),
    sections: [
      { start: 0, end: 4, name: 'Bar 1' },
      { start: 4, end: 8, name: 'Bar 2' },
      { start: 8, end: 12, name: 'Bar 3' },
      { start: 12, end: 16, name: 'Bar 4' },
    ],
  },
  {
    id: 'grv-backbeat',
    title: 'Backbeat Basics',
    pathId: 'grooves',
    difficulty: 1,
    bpm: 80,
    desc: 'The beat behind half of recorded music. Kick on 1 & 3, snare on 2 & 4, hats in eighths.',
    totalBeats: 16,
    countInBeats: 4,
    notes: backbeat(4),
    sections: [
      { start: 0, end: 4, name: 'Bar 1' },
      { start: 4, end: 8, name: 'Bar 2' },
      { start: 8, end: 12, name: 'Bar 3' },
      { start: 12, end: 16, name: 'Bar 4' },
    ],
  },
  {
    id: 'grv-floor',
    title: 'Four on the Floor',
    pathId: 'grooves',
    difficulty: 2,
    bpm: 90,
    desc: 'Kick on every beat — the driving pulse of dance, rock, and pop.',
    totalBeats: 16,
    countInBeats: 4,
    notes: (() => {
      const out: Note[] = [];
      for (let b = 0; b < 16; b++) {
        out.push(n('kick', b));
        out.push(n('hh', b));
        out.push(n('hh', b + 0.5));
      }
      for (let b = 2; b < 16; b += 4) out.push(n('snare', b));
      return out;
    })(),
    sections: [
      { start: 0, end: 4, name: 'Bar 1' },
      { start: 4, end: 8, name: 'Bar 2' },
      { start: 8, end: 12, name: 'Bar 3' },
      { start: 12, end: 16, name: 'Bar 4' },
    ],
  },
  {
    id: 'grv-trap',
    title: 'Trap Step',
    pathId: 'grooves',
    difficulty: 3,
    bpm: 100,
    desc: 'Half-time feel with kick tucked under the snare. Hats in steady eighths.',
    totalBeats: 16,
    countInBeats: 4,
    notes: (() => {
      const out: Note[] = [];
      for (let bar = 0; bar < 4; bar++) {
        const s = bar * 4;
        for (let e = 0; e < 8; e++) out.push(n('hh', s + e * 0.5));
        out.push(n('kick', s));
        out.push(n('kick', s + 1.5));
        out.push(n('snare', s + 1.5));
        out.push(n('kick', s + 2));
        out.push(n('kick', s + 3.5));
        out.push(n('snare', s + 3.5));
      }
      return out;
    })(),
    sections: [
      { start: 0, end: 4, name: 'Bar 1' },
      { start: 4, end: 8, name: 'Bar 2' },
      { start: 8, end: 12, name: 'Bar 3' },
      { start: 12, end: 16, name: 'Bar 4' },
    ],
  },
  {
    id: 'fil-16',
    title: 'Sixteenth Fill',
    pathId: 'fills',
    difficulty: 2,
    bpm: 90,
    desc: 'Groove for eight, then a bar of sixteenths on the snare, landing the crash on one.',
    totalBeats: 17,
    countInBeats: 4,
    notes: [
      ...backbeat(2),
      ...seq('snare', 8, 16, 0.25),
      n('crash', 16),
    ],
    sections: [
      { start: 0, end: 8, name: 'Groove' },
      { start: 8, end: 16, name: 'Snare fill' },
      { start: 16, end: 17, name: 'Crash' },
    ],
  },
  {
    id: 'fil-tom',
    title: 'Tom Cascade',
    pathId: 'fills',
    difficulty: 2,
    bpm: 85,
    desc: 'Sixteenths marching down the kit — snare to low tom to high tom — then the big crash.',
    totalBeats: 17,
    countInBeats: 4,
    notes: [
      ...backbeat(2),
      ...seq('snare', 8, 9, 0.25),
      ...seq('tomLo', 9, 10, 0.25),
      ...seq('tomHi', 10, 11, 0.25),
      ...seq('snare', 11, 12, 0.25),
      ...seq('tomLo', 12, 13, 0.25),
      ...seq('tomHi', 13, 14, 0.25),
      ...seq('snare', 14, 16, 0.25),
      n('crash', 16),
    ],
    sections: [
      { start: 0, end: 8, name: 'Groove' },
      { start: 8, end: 14, name: 'Cascade' },
      { start: 14, end: 17, name: 'Roll + crash' },
    ],
  },
];

export const LESSONS: Lesson[] = lessons.sort((a, b) => {
  const pa = PATHS.findIndex((p) => p.id === a.pathId);
  const pb = PATHS.findIndex((p) => p.id === b.pathId);
  return pa !== pb ? pa - pb : a.difficulty - b.difficulty;
});

export function lessonById(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id);
}

export function lessonsInPath(pathId: string): Lesson[] {
  return LESSONS.filter((l) => l.pathId === pathId);
}
