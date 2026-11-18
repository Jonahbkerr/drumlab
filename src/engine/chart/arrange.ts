/**
 * Turns raw drum hits into a playable chart: beat grid, per-slot cleanup,
 * difficulty levels and a two-hands rule.
 */
import type { DrumKind, Hit } from './drums';

export interface ArrangeOpts {
  /** 1 Easy · 2 Medium · 3 Hard · 4 Full */
  level: number;
  /** 0.5 – 2; higher keeps quieter hits */
  sensitivity: number;
}

export interface ChartNote {
  t: number;
  lane: DrumKind;
  /** 1 = a normal hit; ghost notes are well below */
  strength: number;
}

/** grid built from tracked beats; extrapolates past both ends at the median period */
export class BeatGrid {
  readonly beats: number[];
  readonly period: number;
  constructor(beats: number[], fallbackPeriod: number) {
    this.beats = beats;
    if (beats.length >= 2) {
      const d = beats.slice(1).map((b, i) => b - beats[i]).sort((a, b) => a - b);
      this.period = d[d.length >> 1];
    } else {
      this.period = fallbackPeriod;
    }
  }
  beatTime(i: number): number {
    const b = this.beats;
    if (b.length === 0) return i * this.period;
    if (i < 0) return b[0] + i * this.period;
    if (i >= b.length) return b[b.length - 1] + (i - b.length + 1) * this.period;
    return b[i];
  }
  /** fractional beat index of time t */
  beatAt(t: number): number {
    const b = this.beats;
    if (b.length === 0) return t / this.period;
    if (t < b[0]) return (t - b[0]) / this.period;
    if (t >= b[b.length - 1]) return b.length - 1 + (t - b[b.length - 1]) / this.period;
    let lo = 0;
    let hi = b.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (b[mid] <= t) lo = mid;
      else hi = mid;
    }
    return lo + (t - b[lo]) / (b[hi] - b[lo]);
  }
  /** global 16th-slot index nearest to t */
  slotAt(t: number): number {
    return Math.round(this.beatAt(t) * 4);
  }
  slotTime(slot: number): number {
    const i = Math.floor(slot / 4);
    const j = slot - i * 4;
    const a = this.beatTime(i);
    return a + ((this.beatTime(i + 1) - a) * j) / 4;
  }
}

const BASE_THRESHOLD: Record<DrumKind, number> = { kick: 0.3, snare: 0.3, hh: 0.25, crash: 0.35 };

export function arrange(hits: Hit[], grid: BeatGrid, opts: ArrangeOpts): ChartNote[] {
  const sens = Math.max(0.3, opts.sensitivity);
  // 1. threshold + one note per lane per 16th slot (strongest wins)
  const bySlot = new Map<string, { slot: number; hit: Hit }>();
  for (const h of hits) {
    if (h.strength < BASE_THRESHOLD[h.lane] / sens) continue;
    const slot = grid.slotAt(h.t);
    const key = `${slot}:${h.lane}`;
    const prev = bySlot.get(key);
    if (!prev || prev.hit.strength < h.strength) bySlot.set(key, { slot, hit: h });
  }
  let notes = [...bySlot.values()].map(({ slot, hit }) => ({ slot, t: hit.t, lane: hit.lane, strength: hit.strength }));

  // 2. difficulty
  const level = Math.round(opts.level);
  if (level <= 3) notes = notes.filter((n) => !(n.lane === 'snare' && n.strength < 0.45)); // no ghost notes
  if (level <= 2) notes = notes.filter((n) => n.slot % 2 === 0); // 8th-note grid only
  if (level <= 1) notes = notes.filter((n) => n.lane === 'kick' || n.lane === 'snare');

  // 3. two hands: at most two of snare / hat / crash at once (crash > snare > hat)
  const handRank: Record<DrumKind, number> = { crash: 0, snare: 1, hh: 2, kick: 9 };
  const slots = new Map<number, typeof notes>();
  for (const n of notes) {
    const arr = slots.get(n.slot) ?? [];
    arr.push(n);
    slots.set(n.slot, arr);
  }
  const out: ChartNote[] = [];
  for (const arr of slots.values()) {
    const hands = arr.filter((n) => n.lane !== 'kick').sort((a, b) => handRank[a.lane] - handRank[b.lane]);
    const keep = new Set([...arr.filter((n) => n.lane === 'kick'), ...hands.slice(0, 2)]);
    // notes sharing a slot share one time: the strongest hit's
    const lead = arr.reduce((a, b) => (b.strength > a.strength ? b : a));
    for (const n of keep) out.push({ t: Math.round(lead.t * 1000) / 1000, lane: n.lane, strength: n.strength });
  }
  return out.sort((a, b) => a.t - b.t);
}
