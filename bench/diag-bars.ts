/**
 * Per-bar strength map: for each 16th slot, how far the strongest candidate
 * of a lane sits above its threshold (salience / need). 1.0 = on the line.
 *   npx tsx bench/diag-bars.ts <audio> <lane> <startBar> <bars>
 */
import { decodeFile } from './audio';
import { BeatGrid } from '../src/engine/chart/arrange';
import { analyzeSamples } from '../src/engine/chart/pipeline';
import { loadModel } from './model';

const [file, lane, startArg, barsArg] = process.argv.slice(2);
const a = await analyzeSamples(decodeFile(file, 44100), await loadModel());
const grid = new BeatGrid(a.beats, a.period);
const start = Number(startArg), bars = Number(barsArg);
const cell = (r: number) => (r >= 1.5 ? ' ██' : r >= 1 ? ' ▓▓' : r >= 0.7 ? ' ░░' : r > 0 ? ' ··' : '   ');
console.log(`${lane}: ██ ≥1.5×  ▓▓ 1–1.5× (in chart, marginal)  ░░ 0.7–1× (just missed)  ·· weaker`);
for (let b = start; b < start + bars; b++) {
  const first = (a.downbeat + b * 4) * 4;
  const r = new Array(16).fill(0);
  for (const h of a.hits) {
    if (h.lane !== lane) continue;
    const s = grid.slotAt(h.t) - first;
    if (s >= 0 && s < 16) r[s] = Math.max(r[s], h.salience / h.need);
  }
  console.log(`bar ${String(b).padStart(3)} |${r.map(cell).join('')} |  ${r.map((x) => (x ? x.toFixed(2) : ' -  ')).join(' ')}`);
}
