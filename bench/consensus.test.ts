/**
 * Repeated bars agree: soft notes that flicker around the threshold are
 * settled by the bars that repeat the groove, while real variations
 * (phrase pickups, two-bar patterns, loud one-offs, fills) stay.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BeatGrid, arrange } from '../src/engine/chart/arrange';
import type { Hit } from '../src/engine/chart/arrange';
import type { Lane } from '../src/engine/types';

const NEED = 0.25;
const grid = new BeatGrid(
  Array.from({ length: 64 }, (_, i) => 1 + i * 0.5),
  0.5,
);
const BARS = 8;

/** a hit in bar b at 16th slot s, r = strength as a share of its threshold */
const hit = (b: number, s: number, lane: Lane, r: number): Hit => ({
  t: grid.slotTime(b * 16 + s),
  lane,
  salience: r * NEED,
  prob: 0.6,
  need: NEED,
});

/** a steady groove: kick 1 and 3, snare 2 and 4, eighth hats, all sure */
function groove(b: number): Hit[] {
  const out = [hit(b, 0, 'kick', 3), hit(b, 8, 'kick', 3), hit(b, 4, 'snare', 3), hit(b, 12, 'snare', 3)];
  for (let s = 0; s < 16; s += 2) out.push(hit(b, s, 'hh', 2.8));
  return out;
}

function bars(hits: Hit[]): string[][] {
  const notes = arrange(hits, grid, { level: 5, sensitivity: 1, downbeat: 0 });
  const out: string[][] = Array.from({ length: BARS }, () => []);
  for (const n of notes) {
    const slot = grid.slotAt(n.t);
    const b = Math.floor(slot / 16);
    if (b >= 0 && b < BARS) out[b].push(`${n.lane}@${slot % 16}`);
  }
  return out.map((x) => x.sort());
}

test('flickering soft notes are settled the same way in every repeat', () => {
  const hits: Hit[] = [];
  // a soft 16th hat that is mostly too weak: dropped everywhere
  // (irregular on purpose: a strict alternation would read as a two-bar pattern)
  const weakHat = [1.2, 0.6, 0.7, 1.1, 0.5, 0.8, 1.3, 0.6];
  // a soft kick pickup that is mostly strong enough: kept everywhere
  const softKick = [1.3, 0.8, 0.9, 1.2, 1.4, 1.0, 0.7, 1.1];
  for (let b = 0; b < BARS; b++) {
    hits.push(...groove(b), hit(b, 7, 'hh', weakHat[b]), hit(b, 14, 'kick', softKick[b]));
  }
  const out = bars(hits);
  for (let b = 1; b < BARS; b++) assert.deepEqual(out[b], out[0], `bar ${b} differs from bar 0`);
  assert.ok(!out[0].includes('hh@7'), 'weak flickering hat should go');
  assert.ok(out[0].includes('kick@14'), 'mostly-present soft kick should stay');
});

test('real variations stay: phrase pickups, two-bar patterns, loud one-offs, fills', () => {
  const hits: Hit[] = [];
  for (let b = 0; b < BARS; b++) {
    if (b === 5) {
      // a fill: different sure notes, so no repeats vote on it
      for (const s of [0, 2, 4, 6, 8, 10, 12, 14]) hits.push(hit(b, s, 'tomLo', 2.5));
      hits.push(hit(b, 15, 'snare', 1.2), hit(b, 0, 'kick', 3));
      continue;
    }
    hits.push(...groove(b));
    if (b % 4 === 3) hits.push(hit(b, 14, 'snare', 1.3)); // pickup at the end of every phrase
    if (b % 2 === 0) hits.push(hit(b, 15, 'kick', 1.3)); // two-bar kick pattern
    if (b === 6) hits.push(hit(b, 6, 'kick', 1.9)); // a loud one-off
  }
  const out = bars(hits);
  assert.ok(out[3].includes('snare@14') && out[7].includes('snare@14'), 'phrase pickups kept');
  for (let b = 0; b < BARS; b++) {
    if (b === 5) continue;
    assert.equal(out[b].includes('kick@15'), b % 2 === 0, `two-bar kick pattern in bar ${b}`);
  }
  assert.ok(out[6].includes('kick@6'), 'loud one-off kept');
  assert.ok(out[5].includes('snare@15'), 'fill left alone');
  assert.equal(out[5].filter((x) => x.startsWith('tomLo')).length, 8);
});

test('without a downbeat nothing is voted on (plain threshold)', () => {
  const hits: Hit[] = [];
  for (let b = 0; b < BARS; b++) hits.push(...groove(b), hit(b, 7, 'hh', b % 2 ? 0.6 : 1.2));
  const notes = arrange(hits, grid, { level: 5, sensitivity: 1 });
  const soft = notes.filter((n) => n.lane === 'hh' && grid.slotAt(n.t) % 16 === 7);
  assert.equal(soft.length, 4);
});
