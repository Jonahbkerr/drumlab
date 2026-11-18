/** list the notes that make near-repeat bars differ, with their strength over threshold
 *   npx tsx bench/strays.ts <audio> [level] */
import { basename } from 'node:path';
import { BeatGrid } from '../src/engine/chart/arrange';
import { barSets, cachedAnalysis } from './realsong';

const [file, lv] = process.argv.slice(2);
const a = await cachedAnalysis(file);
const bars = barSets(a, Number(lv ?? 4));
const grid = new BeatGrid(a.beats, a.period);
const r = (bar: number, cell: string) => {
  const [lane, s] = cell.split('@');
  const slot = (a.downbeat + bar * 4) * 4 + Number(s);
  let best = 0;
  for (const h of a.hits) if (h.lane === lane && grid.slotAt(h.t) === slot) best = Math.max(best, h.salience / h.need);
  return best.toFixed(2);
};
const tally: Record<string, number> = {};
for (let b = 1; b < bars.length; b++) {
  let best: { d: number; diff: string[] } = { d: Infinity, diff: [] };
  for (const d of [1, 2, 4]) {
    const p = bars[b - d];
    if (!p || p.size === 0 || bars[b].size === 0) continue;
    const diff = [...[...bars[b]].filter((x) => !p.has(x)).map((x) => `+${x}(${r(b, x)})`), ...[...p].filter((x) => !bars[b].has(x)).map((x) => `-${x}(${r(b, x)})`)];
    if (diff.length < best.d) best = { d: diff.length, diff };
  }
  if (best.d >= 1 && best.d <= 3) {
    for (const x of best.diff) {
      const v = Number(x.match(/\(([\d.]+)\)/)![1]);
      const k = `${x[0]} ${v >= 2 ? 'strong ≥2' : v >= 1 ? 'mid 1–2' : v >= 0.45 ? 'weak .45–1' : 'none <.45'}`;
      tally[k] = (tally[k] ?? 0) + 1;
    }
    if (process.env.V) console.log(`bar ${b}: ${best.diff.join(' ')}`);
  }
}
console.log(basename(file), JSON.stringify(tally));
