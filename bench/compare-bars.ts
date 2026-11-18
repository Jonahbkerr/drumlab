/**
 * Side by side: per-slot strength (salience / threshold) of one lane in the
 * full mix and in the Demucs drum stem, bar by bar.
 *   npx tsx bench/compare-bars.ts <audio> <lane> <startBar> <bars>
 */
import { BeatGrid } from '../src/engine/chart/arrange';
import type { ChartAnalysis } from '../src/engine/chart/pipeline';
import { cachedAnalysis, cachedStemAnalysis } from './realsong';

const [file, lane, startArg, barsArg] = process.argv.slice(2);
const mix = await cachedAnalysis(file);
const stem = await cachedStemAnalysis(file);
// bars counted from the full mix's bar 1 in both, so the slots line up
const grid = new BeatGrid(mix.beats, mix.period);
const first0 = mix.downbeat * 4;
const row = (a: ChartAnalysis, b: number) => {
  const r = new Array(16).fill(0);
  for (const h of a.hits) {
    if (h.lane !== lane) continue;
    const s = grid.slotAt(h.t) - first0 - b * 16;
    if (s >= 0 && s < 16) r[s] = Math.max(r[s], h.salience / h.need);
  }
  return r.map((x) => (x >= 1 ? x.toFixed(1).padStart(4) : x > 0 ? '  · ' : '  - ')).join('');
};
console.log(`${lane}: strength per 16th (≥1 = in the chart, · = weaker candidate, - = nothing)`);
for (let b = Number(startArg); b < Number(startArg) + Number(barsArg); b++) {
  console.log(`bar ${String(b).padStart(3)}  mix ${row(mix, b)}`);
  console.log(`          stem${row(stem, b)}`);
}
