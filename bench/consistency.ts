/**
 * Bar-to-bar consistency of real songs (no ground truth needed).
 *   npx tsx bench/consistency.ts <audio>... [--level 4]
 */
import { basename } from 'node:path';
import { barSets, cachedAnalysis, consistency } from './realsong';

const args = process.argv.slice(2);
const li = args.indexOf('--level');
const level = li >= 0 ? Number(args[li + 1]) : 4;
const files = args.filter((x, i) => !x.startsWith('--') && (li < 0 || i !== li + 1));
for (const f of files) {
  const a = await cachedAnalysis(f);
  const bars = barSets(a, level);
  const notes = bars.reduce((s, b) => s + b.size, 0);
  console.log(`${basename(f).padEnd(22)} L${level}  ${JSON.stringify({ ...consistency(bars), notes })}`);
}
