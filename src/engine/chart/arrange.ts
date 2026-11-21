/**
 * Turns raw drum hits into a playable chart: beat grid, per-slot cleanup,
 * difficulty levels and a two-hands rule.
 */
import type { Lane } from '../types';

/** a detected drum hit, before arrangement */
export interface Hit {
  t: number;
  lane: Lane;
  /** how far the hit stands out above its surroundings (what thresholds apply to) */
  salience: number;
  /** model probability at the peak (ghost notes are low) */
  prob: number;
  /** salience needed at sensitivity 1 */
  need: number;
}

export interface ArrangeOpts {
  /** 1 Pulse · 2 Backbeat · 3 Groove · 4 Full kit · 5 Master */
  level: number;
  /** 0.5 – 2; higher keeps quieter hits */
  sensitivity: number;
  /** beat index of bar 1, beat 1 (4/4). Given, repeated bars are made to agree. */
  downbeat?: number;
}

export interface ChartNote {
  t: number;
  lane: Lane;
  /** model probability at the hit (ghost notes are low) */
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

/** snare hits below this model probability count as ghost notes */
const GHOST = 0.35;

// ── repeated bars agree ──
/** notes this far over their threshold identify a groove; a note's strength counts up to this */
const SURE = 2;
/** notes this far over their threshold are never dropped (one-off variations are often this loud) */
const KEEP = 1.75;
/** bars whose sure notes overlap at least this much (Jaccard) repeat the same groove */
const PEER_SIM = 0.75;
/** a bar needs this many repeats before they may change it (fills and intros have none) */
const MIN_PEERS = 3;
/** weakest candidate (share of its threshold) the repeats may pull into the chart */
const PULL_IN = 0.45;

/**
 * Soft notes near the detection threshold flicker in and out from bar to bar,
 * so one groove reads differently each time it repeats. For each bar, the
 * bars repeating its groove (same sure notes) decide its uncertain notes
 * together, by their average strength there (capped, so one loud outlier
 * cannot carry it): below the threshold on average, a soft note is dropped;
 * above it, a weaker candidate in this bar is kept. When the bars an even
 * distance away and the bars an odd distance away disagree about a note, it
 * belongs to a two-bar pattern and only the same-parity bars decide. A note
 * the bars at the same place in a four-bar phrase nearly all have is never
 * dropped, so pickups at the end of every phrase stay.
 * Returns forced decisions per "slot:lane": true = keep, false = drop.
 */
export function consensus(hits: Hit[], grid: BeatGrid, sens: number, downbeat: number): Map<string, boolean> {
  const first = Math.round(downbeat) * 4; // global slot of bar 0, beat 1
  // per bar: strongest candidate per "lane@slot", as a share of its threshold
  const bars = new Map<number, Map<string, number>>();
  for (const h of hits) {
    const rel = grid.slotAt(h.t) - first;
    const bar = Math.floor(rel / 16);
    const cell = `${h.lane}@${rel - bar * 16}`;
    const r = (h.salience * sens) / h.need;
    let m = bars.get(bar);
    if (!m) bars.set(bar, (m = new Map()));
    if ((m.get(cell) ?? 0) < r) m.set(cell, r);
  }
  const ids = [...bars.keys()];
  const sure = new Map(ids.map((b) => [b, new Set([...bars.get(b)!].filter(([, r]) => r >= 1.5).map(([c]) => c))]));

  const out = new Map<string, boolean>();
  for (const b of ids) {
    const mine = sure.get(b)!;
    if (mine.size < 3) continue;
    const peers: { m: Map<string, number>; even: boolean; phrase: boolean }[] = [];
    for (const p of ids) {
      if (p === b) continue;
      const other = sure.get(p)!;
      let inter = 0;
      for (const c of mine) if (other.has(c)) inter++;
      if (inter / (mine.size + other.size - inter) >= PEER_SIM) peers.push({ m: bars.get(p)!, even: (p - b) % 2 === 0, phrase: (p - b) % 4 === 0 });
    }
    if (peers.length < MIN_PEERS) continue;
    const nEven = 1 + peers.filter((p) => p.even).length; // this bar counts as even
    const nOdd = peers.length + 1 - nEven;
    const nPhrase = 1 + peers.filter((p) => p.phrase).length;
    const m = bars.get(b)!;
    const cells = new Set(m.keys());
    for (const p of peers) for (const [c, r] of p.m) if (r >= 1) cells.add(c);
    for (const cell of cells) {
      const own = m.get(cell) ?? 0;
      let even = Math.min(own, SURE);
      let odd = 0;
      let phraseHas = own >= 1 ? 1 : 0;
      for (const p of peers) {
        const r = Math.min(p.m.get(cell) ?? 0, SURE);
        if (p.even) even += r;
        else odd += r;
        if (p.phrase && r >= 1) phraseHas++;
      }
      const evenMean = even / nEven;
      const twoBar = nOdd > 0 && evenMean >= 1 !== odd / nOdd >= 1;
      const group = twoBar ? evenMean : (even + odd) / (nEven + nOdd);
      // dropping needs every view to agree: all repeats, same parity, same place in the phrase
      const phrasePart = nPhrase >= 2 && phraseHas / nPhrase >= 0.75;
      const absent = group < 1 && evenMean < 1 && !phrasePart;
      const at = cell.indexOf('@');
      const key = `${first + b * 16 + Number(cell.slice(at + 1))}:${cell.slice(0, at)}`;
      if (own >= 1 && own < KEEP && absent) out.set(key, false);
      else if (own < 1 && own >= PULL_IN && group >= 1) out.set(key, true);
    }
  }
  return out;
}

export function arrange(hits: Hit[], grid: BeatGrid, opts: ArrangeOpts): ChartNote[] {
  const sens = Math.max(0.3, opts.sensitivity);
  const forced = opts.downbeat === undefined ? null : consensus(hits, grid, sens, opts.downbeat);
  // 1. threshold (or the repeats' vote) + one note per lane per 16th slot (strongest wins)
  const bySlot = new Map<string, { slot: number; hit: Hit }>();
  for (const h of hits) {
    const slot = grid.slotAt(h.t);
    const key = `${slot}:${h.lane}`;
    const vote = forced?.get(key);
    if (vote === false || (vote !== true && h.salience < h.need / sens)) continue;
    const prev = bySlot.get(key);
    if (!prev || prev.hit.salience < h.salience) bySlot.set(key, { slot, hit: h });
  }
  let notes = [...bySlot.values()].map(({ slot, hit }) => ({ slot, t: hit.t, lane: hit.lane, strength: hit.prob }));

  // notes sharing a slot share one time (the strongest hit's), settled before
  // the level filter so every level places a given note at the same instant
  const lead = new Map<number, { t: number; strength: number }>();
  for (const n of notes) {
    const cur = lead.get(n.slot);
    if (!cur || n.strength > cur.strength) lead.set(n.slot, { t: n.t, strength: n.strength });
  }
  notes = notes.map((n) => ({ ...n, t: Math.round(lead.get(n.slot)!.t * 1000) / 1000 }));

  // 2. difficulty ladder (each level keeps a subset of the one above)
  const level = Math.max(1, Math.min(5, Math.round(opts.level)));
  if (level <= 4) notes = notes.filter((n) => !(n.lane === 'snare' && n.strength < GHOST)); // no ghost notes
  if (level <= 3) notes = notes.filter((n) => n.slot % 2 === 0 && n.lane !== 'tomLo' && n.lane !== 'tomHi'); // 8ths, no fills
  if (level <= 2) notes = notes.filter((n) => n.lane === 'kick' || n.lane === 'snare');
  if (level <= 1) notes = notes.filter((n) => n.slot % 4 === 0); // on the beat only

  // 3. two hands: at most two hand drums at once (crash > snare > toms > hat)
  const handRank: Record<Lane, number> = { crash: 0, snare: 1, tomHi: 2, tomLo: 2, hh: 3, hhOpen: 3, kick: 9 };
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
    for (const n of keep) out.push({ t: n.t, lane: n.lane, strength: n.strength });
  }
  return out.sort((a, b) => a.t - b.t);
}
