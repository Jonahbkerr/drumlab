/**
 * Chart bench: renders the test songs, runs a chart generator on each and
 * scores it against the exact drum parts.
 *
 *   npx tsx bench/run.ts            # compare legacy vs current
 *   npx tsx bench/run.ts current    # one generator
 *   npx tsx bench/run.ts current funk   # one song
 */
import { buildSongs } from './songs';
import { SCORED, prf, scoreSong } from './score';
import type { BenchNote, LaneScore, ScoredLane } from './score';
import { SR } from './synth';
import { generateChart as legacyChart } from './legacy-transcribe';
import { transcribeSamples } from '../src/engine/chart/pipeline';

type Gen = (samples: Float32Array, sr: number) => { bpm: number; notes: BenchNote[] };

export function fakeBuffer(samples: Float32Array, sr: number): AudioBuffer {
  return {
    sampleRate: sr,
    length: samples.length,
    duration: samples.length / sr,
    numberOfChannels: 1,
    getChannelData: () => samples,
  } as unknown as AudioBuffer;
}

export const GENERATORS: Record<string, Gen> = {
  legacy: (s, sr) => {
    const c = legacyChart(fakeBuffer(s, sr), { bpm: 0, threshold: 1, density: 0.55 });
    return { bpm: c.bpm, notes: c.notes };
  },
  current: (s, sr) => {
    const c = transcribeSamples(s, sr, { level: 4, sensitivity: 1 });
    return { bpm: c.bpm, notes: c.notes };
  },
};

const pct = (x: number) => `${Math.round(x * 100)}`.padStart(3);

function runOne(name: string, gen: Gen, songFilter?: string) {
  const songs = buildSongs(songFilter);
  const totals = Object.fromEntries(SCORED.map((l) => [l, { tp: 0, fp: 0, fn: 0, offsets: [] as number[] }])) as Record<
    ScoredLane,
    LaneScore
  >;
  console.log(`\n=== ${name} ===`);
  console.log('song                   bpm(true→got)   kick F (P/R)   snare F (P/R)  hat F (P/R)    crash F   ms bias   secs');
  for (const song of songs) {
    const t0 = performance.now();
    const res = gen(song.samples, SR);
    const secs = (performance.now() - t0) / 1000;
    const sc = scoreSong(res.notes, song.truth);
    const cell = (l: ScoredLane) => {
      const v = prf(sc[l]);
      return `${pct(v.f)} (${pct(v.p)}/${pct(v.r)})`;
    };
    const offs = SCORED.flatMap((l) => sc[l].offsets);
    const bias = offs.length ? (offs.reduce((a, b) => a + b, 0) / offs.length) * 1000 : 0;
    for (const l of SCORED) {
      totals[l].tp += sc[l].tp;
      totals[l].fp += sc[l].fp;
      totals[l].fn += sc[l].fn;
      totals[l].offsets.push(...sc[l].offsets);
    }
    console.log(
      `${song.name.padEnd(22)} ${String(song.bpm).padStart(3)}→${String(Math.round(res.bpm)).padEnd(4)}       ${cell('kick')}   ${cell('snare')}   ${cell('hh')}   ${pct(prf(sc.crash).f)}       ${bias.toFixed(1).padStart(5)}   ${secs.toFixed(1)}`,
    );
  }
  const main = (['kick', 'snare', 'hh'] as const).reduce(
    (a, l) => ({ tp: a.tp + totals[l].tp, fp: a.fp + totals[l].fp, fn: a.fn + totals[l].fn }),
    { tp: 0, fp: 0, fn: 0 },
  );
  const f = (l: ScoredLane) => pct(prf(totals[l]).f);
  console.log(
    `ALL  kick ${f('kick')}  snare ${f('snare')}  hat ${f('hh')}  crash ${f('crash')}   |  kick+snare+hat F = ${pct(prf(main).f)}  (P ${pct(prf(main).p)} / R ${pct(prf(main).r)})`,
  );
  return prf(main).f;
}

const isMain = process.argv[1]?.endsWith('run.ts');
if (isMain) {
  const which = process.argv[2];
  const song = process.argv[3];
  const names = which ? [which] : Object.keys(GENERATORS);
  for (const n of names) runOne(n, GENERATORS[n], song);
}
