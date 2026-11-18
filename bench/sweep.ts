/** Try analysis settings against all test songs (songs rendered once). */
import { buildSongs } from './songs';
import { SR } from './synth';
import { SCORED, prf, scoreSong } from './score';
import { arrangeChart, analyzeSamples } from '../src/engine/chart/pipeline';
import type { AnalyzeOpts } from '../src/engine/chart/pipeline';

const songs = buildSongs();
const configs: AnalyzeOpts[] = JSON.parse(process.argv[2] ?? '[{}]');
const pct = (x: number) => String(Math.round(x * 100)).padStart(3);
for (const cfg of configs) {
  const tot = Object.fromEntries(SCORED.map((l) => [l, { tp: 0, fp: 0, fn: 0 }])) as Record<string, { tp: number; fp: number; fn: number }>;
  const perSong: string[] = [];
  for (const s of songs) {
    const a = analyzeSamples(s.samples, SR, cfg);
    const c = arrangeChart(a, { level: 4, sensitivity: 1 });
    const sc = scoreSong(c.notes, s.truth);
    let m = { tp: 0, fp: 0, fn: 0 };
    for (const l of SCORED) {
      tot[l].tp += sc[l].tp;
      tot[l].fp += sc[l].fp;
      tot[l].fn += sc[l].fn;
      if (l !== 'crash') m = { tp: m.tp + sc[l].tp, fp: m.fp + sc[l].fp, fn: m.fn + sc[l].fn };
    }
    perSong.push(pct(prf(m).f));
  }
  const main = ['kick', 'snare', 'hh'].reduce((a, l) => ({ tp: a.tp + tot[l].tp, fp: a.fp + tot[l].fp, fn: a.fn + tot[l].fn }), { tp: 0, fp: 0, fn: 0 });
  console.log(
    `${JSON.stringify(cfg).padEnd(60)} K${pct(prf(tot.kick).f)} S${pct(prf(tot.snare).f)} H${pct(prf(tot.hh).f)} C${pct(prf(tot.crash).f)} | ALL ${pct(prf(main).f)} | songs ${perSong.join(' ')}`,
  );
}
