/** Salience of true vs false candidate hits per lane, before thresholds. */
import { buildSongs } from './songs';
import { analyzeSamples } from '../src/engine/chart/pipeline';
import { loadModel } from './model';

const only = process.argv[2];
const lanes = ['kick', 'snare', 'hh', 'crash'] as const;
const bins = [0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 9];
for (const song of buildSongs(only)) {
  const a = await analyzeSamples(song.samples, await loadModel());
  console.log(`\n${song.name}`);
  for (const lane of lanes) {
    const ref = song.truth.filter((n) => n.lane === lane).map((n) => n.t);
    const other = song.truth.filter((n) => n.lane !== lane);
    const tp = new Array(bins.length).fill(0);
    const fp = new Array(bins.length).fill(0);
    const cause: Record<string, number> = {};
    const found = new Set<number>();
    for (const h of a.hits.filter((x) => x.lane === lane)) {
      const bi = bins.findIndex((b) => h.salience < b);
      const m = ref.findIndex((t) => Math.abs(t - h.t) < 0.05);
      if (m >= 0) {
        tp[bi]++;
        found.add(m);
      } else {
        fp[bi]++;
        const c = other.find((n) => Math.abs(n.t - h.t) < 0.05);
        cause[c ? c.lane : 'none'] = (cause[c ? c.lane : 'none'] ?? 0) + 1;
      }
    }
    const row = (arr: number[]) => arr.map((v) => String(v).padStart(4)).join('');
    console.log(`  ${lane.padEnd(5)} TP ${row(tp)}   (ref ${ref.length}, never found ${ref.length - found.size})`);
    console.log(`  ${''.padEnd(5)} FP ${row(fp)}   FP coincide with: ${JSON.stringify(cause)}`);
  }
}
console.log(`\nsalience bins (upper edges): ${bins.join(' ')}`);
