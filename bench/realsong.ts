/**
 * Helpers for measuring real songs: cached analyses (local/cache/, delete to
 * re-run the model) and bar-to-bar consistency. A drum part mostly repeats,
 * so a bar matching a nearby bar except for 1–3 notes is almost always
 * detection flicker, not drumming.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { decodeFile } from './audio';
import { BeatGrid } from '../src/engine/chart/arrange';
import { analyzeSamples, arrangeChart } from '../src/engine/chart/pipeline';
import type { ChartAnalysis } from '../src/engine/chart/pipeline';
import { decodeStereo } from './audio';
import { loadDemucs, loadModel } from './model';
import { separateDrums } from '../src/engine/chart/demucs';

export async function cachedAnalysis(file: string): Promise<ChartAnalysis> {
  const dir = 'local/cache';
  const path = `${dir}/${basename(file)}.analysis.json`;
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
  const a = await analyzeSamples(decodeFile(file, 44100), await loadModel());
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(a));
  return a;
}

/** the same, run on the Demucs drum stem; logs how long the separation took */
export async function cachedStemAnalysis(file: string): Promise<ChartAnalysis> {
  const dir = 'local/cache';
  const path = `${dir}/${basename(file)}.stem.analysis.json`;
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
  const [l, r] = decodeStereo(file, 44100);
  const t0 = performance.now();
  let last = 0;
  const drums = await separateDrums(await loadDemucs(), l, r, (p) => {
    if (p - last >= 0.25 || p === 1) {
      last = p;
      process.stderr.write(`  ${basename(file)}: separating ${Math.round(p * 100)}%\n`);
    }
  });
  const secs = (performance.now() - t0) / 1000;
  process.stderr.write(`  ${basename(file)}: ${(l.length / 44100).toFixed(0)} s of audio separated in ${secs.toFixed(0)} s\n`);
  const a = await analyzeSamples(drums, await loadModel());
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(a));
  return a;
}

/** per bar: the set of "lane@slot" notes */
export function barSets(a: ChartAnalysis, level: number): Set<string>[] {
  const c = arrangeChart(a, { level, sensitivity: 1 });
  const grid = new BeatGrid(a.beats, a.period);
  const bars: Set<string>[] = [];
  for (const n of c.notes) {
    const rel = grid.slotAt(n.t) - a.downbeat * 4;
    if (rel < 0) continue;
    const b = Math.floor(rel / 16);
    (bars[b] ??= new Set()).add(`${n.lane}@${rel % 16}`);
  }
  return Array.from(bars, (s) => s ?? new Set<string>());
}

export function consistency(bars: Set<string>[]) {
  let exact = 0;
  let near = 0;
  let stray = 0;
  let counted = 0;
  for (let b = 1; b < bars.length; b++) {
    if (bars[b].size === 0) continue;
    counted++;
    let best = Infinity;
    for (const d of [1, 2, 4]) {
      const p = bars[b - d];
      if (!p || p.size === 0) continue;
      let diff = 0;
      for (const x of bars[b]) if (!p.has(x)) diff++;
      for (const x of p) if (!bars[b].has(x)) diff++;
      best = Math.min(best, diff);
    }
    if (best === 0) exact++;
    else if (best <= 3) {
      near++;
      stray += best;
    }
  }
  return { bars: counted, exactPct: Math.round((100 * exact) / Math.max(1, counted)), nearRepeats: near, strayNotes: stray };
}

