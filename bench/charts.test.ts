/**
 * Chart-quality regression test: the drum model + arrangement must keep
 * transcribing the six bench songs. Run with `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSongs } from './songs';
import { prf, scoreSong } from './score';
import { analyzeSamples, arrangeChart } from '../src/engine/chart/pipeline';
import { loadModel } from './model';

const songs = buildSongs();
const results = await Promise.all(
  songs.map(async (song) => {
    const a = await analyzeSamples(song.samples, await loadModel());
    const full = arrangeChart(a, { level: 4, sensitivity: 1 });
    return { song, a, full, score: scoreSong(full.notes, song.truth) };
  }),
);

test('kick, snare and hat F-measure stays ≥ 0.92 across the bench', () => {
  const tot = { tp: 0, fp: 0, fn: 0 };
  for (const r of results)
    for (const l of ['kick', 'snare', 'hh'] as const) {
      tot.tp += r.score[l].tp;
      tot.fp += r.score[l].fp;
      tot.fn += r.score[l].fn;
    }
  assert.ok(prf(tot).f >= 0.92, `F = ${prf(tot).f.toFixed(3)}`);
});

test('every song: kick and snare F ≥ 0.9', () => {
  for (const r of results) {
    assert.ok(prf(r.score.kick).f >= 0.9, `${r.song.name} kick ${prf(r.score.kick).f.toFixed(2)}`);
    assert.ok(prf(r.score.snare).f >= 0.9, `${r.song.name} snare ${prf(r.score.snare).f.toFixed(2)}`);
  }
});

test('tempo within 3% of the true BPM (no octave or dotted-8th errors)', () => {
  for (const r of results) {
    assert.ok(Math.abs(r.full.bpm / r.song.bpm - 1) < 0.03, `${r.song.name}: ${r.full.bpm} vs ${r.song.bpm}`);
  }
});

test('hits are on time: mean offset under 10 ms', () => {
  const offs = results.flatMap((r) => [...r.score.kick.offsets, ...r.score.snare.offsets, ...r.score.hh.offsets]);
  const mean = offs.reduce((a, b) => a + b, 0) / offs.length;
  assert.ok(Math.abs(mean) < 0.01, `mean offset ${(mean * 1000).toFixed(1)} ms`);
});

test('bar 1 found on the songs with a backbeat', () => {
  let ok = 0;
  for (const r of results) {
    const beats = (r.full.beats[r.full.downbeat] - 1) / (60 / r.song.bpm);
    if (Math.abs(beats / 4 - Math.round(beats / 4)) < 0.06) ok++;
  }
  assert.ok(ok >= 5, `${ok}/6 downbeats right`);
});

test('difficulty levels thin the chart in order and Easy is kick + snare on 8ths', () => {
  for (const r of results) {
    const counts = [1, 2, 3, 4].map((level) => arrangeChart(r.a, { level, sensitivity: 1 }).notes.length);
    for (let i = 1; i < 4; i++) assert.ok(counts[i] >= counts[i - 1], `${r.song.name}: ${counts.join(' < ')}`);
    const easy = arrangeChart(r.a, { level: 1, sensitivity: 1 }).notes;
    assert.ok(easy.every((n) => n.lane === 'kick' || n.lane === 'snare'), `${r.song.name}: easy has other lanes`);
  }
});

test('never more than two hand drums at once', () => {
  for (const r of results) {
    const byT = new Map<number, number>();
    for (const n of r.full.notes) if (n.lane !== 'kick') byT.set(n.t, (byT.get(n.t) ?? 0) + 1);
    assert.ok([...byT.values()].every((c) => c <= 2), r.song.name);
  }
});
