/**
 * Print a generated chart as drum tab, for eyeballing real songs.
 *   npx tsx bench/tab.ts <audio file> [startBar] [bars] [level]
 */
import { decodeFile } from './audio';
import { BeatGrid } from '../src/engine/chart/arrange';
import { analyzeSamples, arrangeChart } from '../src/engine/chart/pipeline';
import { loadModel } from './model';

const [file, startArg, barsArg, levelArg] = process.argv.slice(2);
if (file) {
  const sr = 44100;
  const samples = decodeFile(file, sr);
  const t0 = performance.now();
  const a = await analyzeSamples(samples, await loadModel());
  const c = arrangeChart(a, { level: Number(levelArg ?? 4), sensitivity: 1 });
  const secs = (performance.now() - t0) / 1000;
  const grid = new BeatGrid(a.beats, a.period);
  const counts: Record<string, number> = {};
  for (const n of c.notes) counts[n.lane] = (counts[n.lane] ?? 0) + 1;
  console.log(`${file.split('/').pop()}  (bars start at beat ${a.downbeat})`);
  console.log(
    `  ${(samples.length / sr).toFixed(0)}s · ${c.bpm} BPM · ${c.notes.length} notes (${(c.notes.length / (samples.length / sr)).toFixed(1)}/s) ${JSON.stringify(counts)} · analysis ${secs.toFixed(1)}s`,
  );
  const startBar = Number(startArg ?? 8);
  const bars = Number(barsArg ?? 8);
  const rows: [string, string][] = [
    ['crash', 'CY'],
    ['hh', 'HH'],
    ['tomHi', 'T1'],
    ['snare', 'SD'],
    ['tomLo', 'T2'],
    ['kick', 'BD'],
  ];
  for (let b0 = startBar; b0 < startBar + bars; b0 += 2) {
    const lines = rows.map(([, lab]) => `${lab} |`);
    const first = (a.downbeat + b0 * 4) * 4;
    for (let s = first; s < first + 32; s++) {
      rows.forEach(([lane], i) => {
        const hit = c.notes.find((n) => n.lane === lane && grid.slotAt(n.t) === s);
        lines[i] += hit ? (hit.strength >= 0.6 ? 'X' : 'x') : (s - first) % 4 === 0 ? '·' : '-';
        if ((s - first) % 16 === 15) lines[i] += "|";
      });
    }
    console.log(`  bar ${b0}  @${grid.slotTime(first).toFixed(1)}s`);
    for (const l of lines) console.log(`  ${l}`);
  }
}
