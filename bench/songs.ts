/**
 * Six full-mix test songs with an exact drum ground truth. Each one targets
 * a way real songs break drum charting: bass plucks under the kick,
 * distorted guitar chugs, swung 16th hats, offbeat synth bass, ghost notes,
 * quiet drums under piano arpeggios.
 */
import {
  SR,
  bass,
  clap,
  crash,
  guitar,
  hat,
  keys,
  kick,
  lead,
  master,
  pad,
  ride,
  rng,
  snare,
} from './synth';
import type { KickOpts, SnareOpts } from './synth';
import { tom } from './synth';

export type TruthLane = 'kick' | 'snare' | 'hh' | 'crash';
export interface TruthNote {
  t: number;
  lane: TruthLane | 'tom';
  ghost?: boolean;
}

export interface TestSong {
  name: string;
  bpm: number;
  samples: Float32Array;
  truth: TruthNote[];
}

interface Bar {
  K?: string;
  S?: string;
  H?: string;
  C?: string;
  T?: string;
}

interface SongSpec {
  name: string;
  bpm: number;
  seed: number;
  swing?: number; // fraction of a 16th the off-16ths are delayed
  kick?: KickOpts;
  snare?: SnareOpts;
  clap?: boolean;
  drumGain?: number;
  hatBright?: number;
  bars: string[];
  patterns: Record<string, Bar>;
  harmony: (out: Float32Array, bar: number, t0: number, beat: number, r: () => number) => void;
}

function render(spec: SongSpec): TestSong {
  const beat = 60 / spec.bpm;
  const six = beat / 4;
  const lead = 1.0; // one second of silence before bar 1
  const total = lead + spec.bars.length * beat * 4 + 3;
  const drums = new Float32Array(Math.ceil(total * SR));
  const music = new Float32Array(drums.length);
  const r = rng(spec.seed);
  const gauss = () => {
    const u = Math.max(1e-9, r());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
  };
  const truth: TruthNote[] = [];
  spec.bars.forEach((name, b) => {
    const pat = spec.patterns[name];
    const t0 = lead + b * beat * 4;
    spec.harmony(music, b, t0, beat, r);
    for (let i = 0; i < 16; i++) {
      const swing = i % 2 === 1 ? (spec.swing ?? 0) * six : 0;
      const at = (ch: string | undefined) => (ch ? ch[i] ?? '.' : '.');
      const jitter = () => Math.max(-0.012, Math.min(0.012, gauss() * 0.005));
      const vel = (c: string) => (c === 'X' ? 1 : c === 'g' ? 0.22 : 0.78 + r() * 0.12);
      const base = t0 + i * six + swing;
      const k = at(pat.K);
      if (k !== '.') {
        const t = base + jitter();
        kick(drums, t, vel(k), r, spec.kick);
        truth.push({ t, lane: 'kick' });
      }
      const s = at(pat.S);
      if (s !== '.') {
        const t = base + jitter();
        if (spec.clap) clap(drums, t, vel(s), r);
        else snare(drums, t, vel(s), r, spec.snare);
        truth.push({ t, lane: 'snare', ghost: s === 'g' });
      }
      const h = at(pat.H);
      if (h !== '.') {
        const t = base + jitter();
        if (h === 'r') ride(drums, t, vel('x') * 0.9, r);
        else hat(drums, t, h === 'X' ? 0.95 : h === 'o' ? 0.8 : 0.62, r, h === 'o', spec.hatBright ?? 1);
        // the app's cymbal lane is crash + ride (a ride pad sends GM 51 → 'crash')
        truth.push({ t, lane: h === 'r' ? 'crash' : 'hh' });
      }
      const c = at(pat.C);
      if (c !== '.') {
        const t = base + jitter();
        crash(drums, t, 0.9, r);
        truth.push({ t, lane: 'crash' });
      }
      const tm = at(pat.T);
      if (tm !== '.') {
        const t = base + jitter();
        tom(drums, t, 0.85, r, 150 - i * 4);
        truth.push({ t, lane: 'tom' });
      }
    }
  });
  const g = spec.drumGain ?? 1;
  const out = new Float32Array(drums.length);
  for (let i = 0; i < out.length; i++) out[i] = drums[i] * g + music[i];
  master(out);
  truth.sort((a, b) => a.t - b.t);
  return { name: spec.name, bpm: spec.bpm, samples: out, truth };
}

const rep = (n: number, s: string) => Array.from({ length: n }, () => s);

const SPECS: SongSpec[] = [
  {
    name: 'rock-8ths-100',
    bpm: 100,
    seed: 11,
    bars: [
      'crashA', ...rep(6, 'A'), 'fill',
      'crashB', ...rep(6, 'B'), 'fill',
      'crashA', ...rep(3, 'A'),
    ],
    patterns: {
      A: { K: 'x.......x.x.....', S: '....x.......x...', H: 'x.x.x.x.x.x.x.x.' },
      crashA: { K: 'x.......x.x.....', S: '....x.......x...', H: '..x.x.x.x.x.x.x.', C: 'x...............' },
      B: { K: 'x.....x.x.x.....', S: '....x.......x...', H: 'x.x.x.x.x.x.x.x.' },
      crashB: { K: 'x.....x.x.x.....', S: '....x.......x...', H: '..x.x.x.x.x.x.x.', C: 'x...............' },
      fill: { K: 'x.......x.......', S: '....x...x.x.....', H: 'x.x.x.x.........', T: '............xxxx' },
    },
    harmony: (out, bar, t0, beat, r) => {
      const roots = [40, 36, 43, 38];
      const root = roots[bar % 4];
      const chorus = bar >= 8 && bar < 16;
      for (let i = 0; i < 8; i++) {
        const t = t0 + (i * beat) / 2;
        bass(out, t, beat / 2 - 0.02, root - 12 + 12, 0.8);
        if (!chorus) guitar(out, t, beat / 2, root, 0.75 + r() * 0.1, true);
      }
      if (chorus) guitar(out, t0, beat * 4 - 0.03, root, 0.8, false);
    },
  },
  {
    name: 'dance-4otf-124',
    bpm: 124,
    seed: 22,
    clap: true,
    kick: { f0: 170, f1: 48, decay: 0.2, click: 0.25 },
    bars: ['crash', ...rep(7, 'A'), 'crash16', ...rep(7, 'B'), 'crash16', ...rep(7, 'B')],
    patterns: {
      A: { K: 'x...x...x...x...', S: '....x.......x...', H: '..o...o...o...o.' },
      crash: { K: 'x...x...x...x...', S: '....x.......x...', H: '..o...o...o...o.', C: 'x...............' },
      B: { K: 'x...x...x...x...', S: '....x.......x...', H: '.xo.xxo.xxo.xxo.' },
      crash16: { K: 'x...x...x...x...', S: '....x.......x...', H: '.xo.xxo.xxo.xxo.', C: 'x...............' },
    },
    harmony: (out, bar, t0, beat) => {
      const roots = [45, 41, 48, 43];
      const root = roots[Math.floor(bar / 2) % 4];
      for (let i = 0; i < 4; i++) bass(out, t0 + i * beat + beat / 2, beat / 2 - 0.03, root - 12, 0.9, 900);
      pad(out, t0, beat * 4, [root + 12, root + 16, root + 19], 0.9);
      if (bar % 2 === 0) lead(out, t0 + beat, beat * 2.5, root + 24, 0.6);
    },
  },
  {
    name: 'hiphop-swing-88',
    bpm: 88,
    seed: 33,
    swing: 0.32,
    kick: { f0: 120, f1: 45, decay: 0.55, pitchDecay: 0.05, click: 0.15, drive: 2.2 },
    snare: { noiseDecay: 0.2, toneMix: 0.35, noiseHz: 3000 },
    bars: rep(16, 'A').map((b, i) => (i % 4 === 3 ? 'B' : b)),
    patterns: {
      A: { K: 'x......x..x.....', S: '....x.......x...', H: 'XxXxXxXxXxXxXxXx' },
      B: { K: 'x......x..x...x.', S: '....x.......x...', H: 'XxXxXxXxXxXxXx..' },
    },
    harmony: (out, bar, t0, beat, r) => {
      const chords = [
        [57, 60, 64, 67],
        [53, 57, 60, 64],
        [55, 59, 62, 65],
        [52, 55, 59, 62],
      ];
      const c = chords[bar % 4];
      keys(out, t0, beat * 1.4, c, 0.8, r);
      keys(out, t0 + beat * 2.5, beat * 1.2, c, 0.6, r);
      lead(out, t0 + beat * 0.5, beat * 1.5, c[3] + 12, 0.55);
      lead(out, t0 + beat * 2.25, beat * 1.5, c[2] + 12, 0.5);
    },
  },
  {
    name: 'halftime-metal-140',
    bpm: 140,
    seed: 44,
    kick: { f0: 160, f1: 55, decay: 0.16, click: 0.6 },
    snare: { noiseDecay: 0.14, toneMix: 0.4, noiseHz: 4200 },
    bars: ['crash', 'A', 'A', 'fill', 'crash', 'A', 'B', 'fill', 'crash', 'B', 'B', 'fill', 'crash', 'A', 'A', 'B'],
    patterns: {
      A: { K: 'x.....x...x..x..', S: '........x.......', H: 'x.x.x.x.x.x.x.x.' },
      crash: { K: 'x.....x...x..x..', S: '........x.......', H: '..x.x.x.x.x.x.x.', C: 'x...............' },
      B: { K: 'xx....x.xx..x...', S: '........x.......', H: 'x.x.x.x.x.x.x.x.' },
      fill: { K: 'x.....x.........', S: '........x.xxxx..', H: 'x.x.x.x.........', T: '..............xx' },
    },
    harmony: (out, bar, t0, beat) => {
      const roots = [38, 38, 41, 36];
      const root = roots[bar % 4];
      // chugs locked to the kick pattern, sustained chord on the snare
      const chug = [0, 1, 6, 8, 9, 12];
      for (const i of chug) guitar(out, t0 + (i * beat) / 4, beat / 4, root, 0.85, true);
      guitar(out, t0 + 2 * beat, beat * 1.4, root + 3, 0.7, false);
      bass(out, t0, beat * 2 - 0.05, root - 12 + 12, 0.85);
      bass(out, t0 + 2 * beat, beat * 2 - 0.05, root + 3, 0.85);
    },
  },
  {
    name: 'funk-ghosts-104',
    bpm: 104,
    seed: 55,
    bars: rep(16, 'A').map((b, i) => (i % 4 === 3 ? 'B' : b)),
    patterns: {
      A: { K: 'x..x..x...x..x..', S: '....x..g.g..x..g', H: 'XxXxXxXxXxXxXxXx' },
      B: { K: 'x..x..x...x.x...', S: '....x..g.g..x.xx', H: 'XxXxXxXxXxXxXx.o' },
    },
    harmony: (out, bar, t0, beat, r) => {
      const root = [40, 40, 45, 43][bar % 4];
      const line = [0, 3, 6, 7, 10, 13, 14];
      line.forEach((i, j) => bass(out, t0 + (i * beat) / 4, beat / 4, root + (j % 3 === 2 ? 12 : 0), 0.85, 1300));
      for (const i of [2, 6, 10, 14]) keys(out, t0 + (i * beat) / 4, beat / 5, [root + 24, root + 28, root + 31, root + 34], 0.7, r);
    },
  },
  {
    name: 'ballad-ride-72',
    bpm: 72,
    seed: 66,
    drumGain: 0.55,
    snare: { toneMix: 0.6, noiseDecay: 0.12 },
    bars: ['crash', ...rep(5, 'A'), 'crash', ...rep(5, 'A')],
    patterns: {
      A: { K: 'x.......x.......', S: '....x.......x...', H: 'r.r.r.r.r.r.r.r.' },
      crash: { K: 'x.......x.......', S: '....x.......x...', H: '..r.r.r.r.r.r.r.', C: 'x...............' },
    },
    harmony: (out, bar, t0, beat, r) => {
      const chords = [
        [48, 55, 60, 64],
        [45, 52, 57, 60],
        [41, 48, 53, 57],
        [43, 50, 55, 59],
      ];
      const c = chords[bar % 4];
      // piano arpeggio on every 8th — lots of non-drum onsets
      for (let i = 0; i < 8; i++) keys(out, t0 + (i * beat) / 2, beat / 2, [c[i % 4] + 12], 0.75, r);
      pad(out, t0, beat * 4, c, 1);
      lead(out, t0 + beat, beat * 2, c[2] + 12, 0.6);
    },
  },
];

export function buildSongs(only?: string): TestSong[] {
  return SPECS.filter((s) => !only || s.name.includes(only)).map(render);
}
