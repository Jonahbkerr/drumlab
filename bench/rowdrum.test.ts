/**
 * The drums drawn in the chart's row labels: every drum draws in every state
 * (idle, just hit, note coming, missed, hat open) without leaving the canvas
 * transformed or painting an invalid colour.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawRowDrum } from '../src/engine/rowDrum';
import type { DrumState } from '../src/engine/rowDrum';
import { LANES, ROW_OF } from '../src/engine/types';

/** a canvas context that records what was painted */
function fakeCtx() {
  const log = { depth: 0, minDepth: 0, paints: 0, styles: [] as string[] };
  const gradient = { addColorStop: (_o: number, c: string) => log.styles.push(c) };
  const target: Record<string, unknown> = {
    save: () => log.depth++,
    restore: () => {
      log.depth--;
      log.minDepth = Math.min(log.minDepth, log.depth);
    },
    fill: () => log.paints++,
    stroke: () => log.paints++,
    fillRect: () => log.paints++,
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
  };
  const ctx = new Proxy(target, {
    get: (t, k: string) => t[k] ?? (() => {}),
    set: (t, k: string, v) => {
      if ((k === 'fillStyle' || k === 'strokeStyle') && typeof v === 'string') log.styles.push(v);
      t[k] = v;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log };
}

const idle: DrumState = {
  color: '#56bee3',
  hitAge: Infinity,
  vel: 1,
  cue: 0,
  cueColor: '#56bee3',
  missAge: Infinity,
  lift: 0,
  motion: true,
};
const STATES: Record<string, DrumState> = {
  idle,
  'just hit': { ...idle, hitAge: 0.02, vel: 0.6 },
  'hit before the frame clock': { ...idle, hitAge: -0.01 },
  'note coming': { ...idle, cue: 1 },
  missed: { ...idle, missAge: 0.1 },
  'hat open': { ...idle, hitAge: 0.3, lift: 1 },
  'no motion': { ...idle, hitAge: 0.02, motion: false },
};

test('every row drum draws in every state and leaves the canvas as it found it', () => {
  for (const lane of new Set(LANES.map((l) => ROW_OF[l]))) {
    for (const [name, st] of Object.entries(STATES)) {
      const { ctx, log } = fakeCtx();
      drawRowDrum(ctx, lane, 68, 100, 100, st);
      assert.equal(log.depth, 0, `${lane}, ${name}: save/restore balanced`);
      assert.equal(log.minDepth, 0, `${lane}, ${name}: never restores more than it saved`);
      assert.ok(log.paints >= 5, `${lane}, ${name}: draws something`);
      for (const s of log.styles) assert.ok(/^(#[0-9a-f]{6}|rgba\((\d+,){3}[\d.]+\))$/i.test(s), `${lane}, ${name}: colour ${s}`);
    }
  }
});

test('a hit lights the drum and a miss rings it red', () => {
  const painted = (st: DrumState) => {
    const { ctx, log } = fakeCtx();
    drawRowDrum(ctx, 'snare', 68, 100, 100, st);
    return log;
  };
  assert.ok(painted(STATES['just hit']).paints > painted(idle).paints, 'flash and glow are extra paint');
  assert.ok(painted(STATES.missed).styles.some((s) => s.startsWith('rgba(229,83,75')), 'miss ring is red');
  assert.ok(!painted(idle).styles.some((s) => s.startsWith('rgba(229,83,75')));
});
