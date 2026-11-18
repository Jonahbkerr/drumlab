import type { TruthNote } from './songs';

export interface BenchNote {
  t: number;
  lane: string;
}

export interface LaneScore {
  tp: number;
  fp: number;
  fn: number;
  offsets: number[]; // detected − true, seconds, for matched notes
}

export const SCORED = ['kick', 'snare', 'hh', 'crash'] as const;
export type ScoredLane = (typeof SCORED)[number];

/** one-to-one matching, closest pairs first (mir_eval onset style) */
function match(det: number[], ref: number[], tol: number) {
  const pairs: [number, number, number][] = [];
  let j0 = 0;
  for (let i = 0; i < det.length; i++) {
    while (j0 < ref.length && ref[j0] < det[i] - tol) j0++;
    for (let j = j0; j < ref.length && ref[j] <= det[i] + tol; j++) pairs.push([Math.abs(det[i] - ref[j]), i, j]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  const usedD = new Set<number>();
  const usedR = new Set<number>();
  const offsets: number[] = [];
  for (const [, i, j] of pairs) {
    if (usedD.has(i) || usedR.has(j)) continue;
    usedD.add(i);
    usedR.add(j);
    offsets.push(det[i] - ref[j]);
  }
  return { tp: offsets.length, usedD, offsets };
}

const near = (t: number, list: number[], tol: number) => list.some((x) => Math.abs(x - t) <= tol);

export function scoreSong(notes: BenchNote[], truth: TruthNote[], tol = 0.05): Record<ScoredLane, LaneScore> {
  const ghosts = truth.filter((n) => n.ghost).map((n) => n.t);
  const toms = truth.filter((n) => n.lane === 'tom').map((n) => n.t);
  const out = {} as Record<ScoredLane, LaneScore>;
  for (const lane of SCORED) {
    const ref = truth.filter((n) => n.lane === lane && !n.ghost).map((n) => n.t);
    let det = notes.filter((n) => n.lane === lane).map((n) => n.t);
    // ghost snares and tom fills are optional: neither rewarded nor punished
    if (lane === 'snare') det = det.filter((t) => near(t, ref, tol) || !near(t, ghosts, tol));
    if (lane === 'kick' || lane === 'snare') det = det.filter((t) => near(t, ref, tol) || !near(t, toms, tol));
    det.sort((a, b) => a - b);
    const m = match(det, ref, tol);
    out[lane] = { tp: m.tp, fp: det.length - m.tp, fn: ref.length - m.tp, offsets: m.offsets };
  }
  return out;
}

export function prf(s: { tp: number; fp: number; fn: number }) {
  const p = s.tp + s.fp > 0 ? s.tp / (s.tp + s.fp) : 0;
  const r = s.tp + s.fn > 0 ? s.tp / (s.tp + s.fn) : 0;
  const f = p + r > 0 ? (2 * p * r) / (p + r) : 0;
  return { p, r, f };
}
