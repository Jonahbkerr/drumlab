/**
 * Checks the repeated-bars vote against the test songs' exact drum parts:
 * every note it drops or keeps is compared with the truth.
 *   npx tsx bench/vote-check.ts [song filter]
 */
import { BeatGrid, consensus } from '../src/engine/chart/arrange';
import { analyzeSamples } from '../src/engine/chart/pipeline';
import { loadModel } from './model';
import { buildSongs } from './songs';

let right = 0;
let droppedReal = 0;
let keptNothing = 0;
for (const song of buildSongs(process.argv[2])) {
  const a = await analyzeSamples(song.samples, await loadModel());
  const grid = new BeatGrid(a.beats, a.period);
  const first = Math.round(a.downbeat) * 4;
  const rOf = (slot: number, lane: string) =>
    Math.max(0, ...a.hits.filter((h) => h.lane === lane && grid.slotAt(h.t) === slot).map((h) => h.salience / h.need));
  const lines: string[] = [];
  for (const [k, keep] of consensus(a.hits, grid, 1, a.downbeat)) {
    const [s, lane] = k.split(':');
    const slot = Number(s);
    const t = song.truth.find((n) => n.lane === lane && grid.slotAt(n.t) === slot);
    const real = !!t && !t.ghost;
    const where = `${lane} bar ${Math.floor((slot - first) / 16)} slot ${(slot - first) % 16} (${rOf(slot, lane).toFixed(2)}×)`;
    if (keep && !t) {
      keptNothing++;
      lines.push(`   kept, but nothing there: ${where}`);
    } else if (!keep && real) {
      droppedReal++;
      lines.push(`   DROPPED A REAL NOTE: ${where}`);
    } else right++;
  }
  console.log(song.name);
  for (const l of lines) console.log(l);
}
console.log(`right ${right} · dropped real ${droppedReal} · kept nothing ${keptNothing}`);
