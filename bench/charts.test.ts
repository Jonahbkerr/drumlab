/**
 * Chart-quality regression test: the drum model + arrangement must keep
 * transcribing the six bench songs. Run with `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSongs } from './songs';
import { prf, scoreSong } from './score';
import { analyzeSamples, arrangeChart } from '../src/engine/chart/pipeline';
import { BeatGrid } from '../src/engine/chart/arrange';
import { DEFAULT_SETTINGS, levelId, parseLevelId, songLevels } from '../src/engine/transcribe';
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

test('level ladder: each level contains the one below it', () => {
  for (const r of results) {
    const lv = [1, 2, 3, 4, 5].map((level) => arrangeChart(r.a, { level, sensitivity: 1 }).notes);
    const key = (n: { t: number; lane: string }) => `${n.t}:${n.lane}`;
    for (let i = 1; i < 5; i++) {
      const above = new Set(lv[i].map(key));
      assert.ok(lv[i - 1].every((n) => above.has(key(n))), `${r.song.name}: level ${i} not inside level ${i + 1}`);
    }
    assert.ok(lv[0].every((n) => n.lane === 'kick' || n.lane === 'snare'), `${r.song.name}: Pulse has other lanes`);
    assert.ok(lv[1].every((n) => n.lane === 'kick' || n.lane === 'snare'), `${r.song.name}: Backbeat has other lanes`);
    assert.ok(lv[2].every((n) => n.lane !== 'tomLo' && n.lane !== 'tomHi'), `${r.song.name}: Groove has toms`);
  }
});

test('Pulse sits on the beat, Backbeat and Groove on 8th notes', () => {
  for (const r of results) {
    const grid = new BeatGrid(r.a.beats, r.a.period);
    const onGrid = (level: number, every: number) =>
      arrangeChart(r.a, { level, sensitivity: 1 }).notes.every((n) => grid.slotAt(n.t) % every === 0);
    assert.ok(onGrid(1, 4), `${r.song.name}: Pulse off the beat`);
    assert.ok(onGrid(2, 2) && onGrid(3, 2), `${r.song.name}: 16ths below Full kit`);
  }
});

test('songLevels: ids per level, easiest first, every shown level adds ≥ 5% notes', () => {
  for (const r of results) {
    const levels = songLevels(r.a, DEFAULT_SETTINGS, r.song.name, 'song-x');
    assert.ok(levels.length >= 2, `${r.song.name}: only ${levels.length} levels`);
    levels.forEach((l, i) => {
      assert.equal(l.chart.id, levelId('song-x', l.level));
      assert.deepEqual(parseLevelId(l.chart.id), { songId: 'song-x', level: l.level });
      if (i > 0) {
        assert.ok(l.level > levels[i - 1].level);
        assert.ok(l.chart.notes.length >= levels[i - 1].chart.notes.length * 1.05, `${r.song.name}: level ${l.level} too close`);
      }
    });
  }
});

test('never more than two hand drums at once', () => {
  for (const r of results) {
    const byT = new Map<number, number>();
    for (const n of r.full.notes) if (n.lane !== 'kick') byT.set(n.t, (byT.get(n.t) ?? 0) + 1);
    assert.ok([...byT.values()].every((c) => c <= 2), r.song.name);
  }
});
