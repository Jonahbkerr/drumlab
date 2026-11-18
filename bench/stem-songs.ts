/**
 * Real songs, full mix vs Demucs drum stem: tempo, bar starts, note counts
 * and bar-to-bar consistency.
 *   npx tsx bench/stem-songs.ts <audio>...
 */
import { basename } from 'node:path';
import { setThreads } from './model';
import { barSets, cachedAnalysis, cachedStemAnalysis, consistency } from './realsong';
import { mergeStem } from '../src/engine/chart/pipeline';
import type { ChartAnalysis } from '../src/engine/chart/pipeline';

setThreads(8);
const bpm = (a: ChartAnalysis) => Math.round(600 / a.period) / 10;
for (const f of process.argv.slice(2)) {
  const mix = await cachedAnalysis(f);
  const stem = await cachedStemAnalysis(f);
  console.log(`\n${basename(f)}`);
  console.log(`  tempo ${bpm(mix)} → ${bpm(stem)} bpm · bar 1 at beat ${mix.downbeat} → ${stem.downbeat} · beat 1 at ${mix.beats[mix.downbeat]?.toFixed(2)} s → ${stem.beats[stem.downbeat]?.toFixed(2)} s`);
  for (const level of [3, 4]) {
    for (const [name, a] of [['mix   ', mix], ['stem  ', stem], ['hybrid', mergeStem(mix, stem)]] as const) {
      const bars = barSets(a, level);
      const notes = bars.reduce((s, b) => s + b.size, 0);
      console.log(`  L${level} ${name}  ${JSON.stringify({ ...consistency(bars), notes })}`);
    }
  }
}
