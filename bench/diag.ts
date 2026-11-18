/** Strength histograms of true vs false candidate hits per lane (no thresholds). */
import { buildSongs } from './songs';
import { SR } from './synth';
import { analyzeSamples } from '../src/engine/chart/pipeline';

const only = process.argv[2];
const lanes = ['kick', 'snare', 'hh', 'crash'] as const;
const bins = [0.08, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0, 9];
for (const song of buildSongs(only)) {
  const a = analyzeSamples(song.samples, SR);
  console.log(`\n${song.name}`);
  for (const lane of lanes) {
    const ref = song.truth.filter((n) => n.lane === lane).map((n) => n.t);
    const other = song.truth.filter((n) => n.lane !== lane);
    const tp = new Array(bins.length).fill(0);
    const fp = new Array(bins.length).fill(0);
    const fpCause: Record<string, number> = {};
    for (const h of a.hits.filter((x) => x.lane === lane)) {
      const bi = bins.findIndex((b) => h.strength < b);
      if (ref.some((t) => Math.abs(t - h.t) < 0.05)) tp[bi]++;
      else {
        fp[bi]++;
        if (h.strength >= 0.3) {
          const c = other.find((n) => Math.abs(n.t - h.t) < 0.05);
          const k = c ? c.lane : 'none';
          fpCause[k] = (fpCause[k] ?? 0) + 1;
        }
      }
    }
    const row = (arr: number[]) => arr.map((v) => String(v).padStart(4)).join('');
    console.log(`  ${lane.padEnd(5)} TP ${row(tp)}   (ref ${ref.length})`);
    console.log(`  ${''.padEnd(5)} FP ${row(fp)}   FP≥0.3 coincide with: ${JSON.stringify(fpCause)}`);
  }
}
console.log(`\nbins (upper edges): ${bins.join(' ')}`);
