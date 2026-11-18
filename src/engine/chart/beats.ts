/**
 * Tempo + beat tracking (Ellis 2007 dynamic programming): beats land on
 * strong onsets while keeping a steady period, so the grid follows the
 * real track instead of a BPM guessed once and extrapolated.
 */

/**
 * Onset strength from the drum model output plus spectral flux:
 * positive change per frame, slow trend removed, unit RMS.
 */
export function onsetNovelty(
  act: Float32Array,
  classes: number,
  weights: number[],
  spec: { frames: number; bins: number; data: Float32Array },
  fps: number,
): Float32Array {
  const { frames, bins, data } = spec;
  const drum = new Float32Array(frames);
  const flux = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    let d = 0;
    for (let c = 0; c < classes; c++) d += weights[c] * Math.max(0, act[f * classes + c] - act[(f - 1) * classes + c]);
    drum[f] = d;
    let s = 0;
    for (let b = 0; b < bins; b++) s += Math.max(0, data[f * bins + b] - data[(f - 1) * bins + b]);
    flux[f] = s;
  }
  const norm = (x: Float32Array) => {
    let sd = 0;
    for (let f = 0; f < frames; f++) sd += x[f] * x[f];
    sd = Math.sqrt(sd / Math.max(1, frames)) || 1;
    for (let f = 0; f < frames; f++) x[f] /= sd;
  };
  norm(drum);
  norm(flux);
  const nov = new Float32Array(frames);
  for (let f = 0; f < frames; f++) nov[f] = 2 * drum[f] + flux[f];
  // remove the slowly varying loudness trend, keep the spikes
  const w = Math.round(fps * 0.4);
  const out = new Float32Array(frames);
  let acc = 0;
  for (let f = 0; f < Math.min(frames, w); f++) acc += nov[f];
  for (let f = 0; f < frames; f++) {
    const lo = f - w - 1;
    const hi = f + w;
    if (hi < frames) acc += nov[hi];
    if (lo >= 0) acc -= nov[lo];
    const n = Math.min(frames - 1, hi) - Math.max(0, lo + 1) + 1;
    out[f] = Math.max(0, nov[f] - acc / n);
  }
  norm(out);
  return out;
}

/** beat period in frames (fractional), log-Gaussian tempo prior around 115 BPM */
export function estimatePeriod(nov: Float32Array, fps: number): number {
  const n = nov.length;
  const minLag = Math.floor((fps * 60) / 200);
  const maxLag = Math.min(n - 2, Math.ceil((fps * 60) / 55));
  if (maxLag <= minLag) return (fps * 60) / 120;
  const ac = new Float64Array(maxLag * 4 + 2);
  const acAt = (lag: number) => {
    if (lag >= ac.length || lag >= n) return 0;
    if (ac[lag] === 0) {
      let s = 0;
      for (let i = 0; i + lag < n; i++) s += nov[i] * nov[i + lag];
      ac[lag] = s / (n - lag) + 1e-12;
    }
    return ac[lag];
  };
  let best = -Infinity;
  let bestLag = minLag;
  const score = new Float64Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag; lag++) {
    // a true beat period also explains its bar-level multiples and its
    // 8th/16th subdivisions (rejects syncopation periods like dotted 8ths)
    const comb =
      acAt(lag) +
      0.5 * acAt(2 * lag) +
      0.25 * acAt(4 * lag) +
      0.5 * acAt(Math.round(lag / 2)) +
      0.25 * acAt(Math.round(lag / 4));
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 115) / 0.75) ** 2);
    score[lag] = comb * prior;
    if (score[lag] > best) {
      best = score[lag];
      bestLag = lag;
    }
  }
  // parabolic refinement on the score curve
  const y0 = score[bestLag - 1] ?? 0;
  const y1 = score[bestLag];
  const y2 = score[bestLag + 1] ?? 0;
  const den = y0 - 2 * y1 + y2;
  const dx = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den)) : 0;
  return bestLag + dx;
}

/** Beat frames via DP. tightness trades onset fit against tempo steadiness. */
export function trackBeats(nov: Float32Array, period: number, tightness = 120): number[] {
  const n = nov.length;
  if (n === 0) return [];
  const C = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const lo = Math.round(period / 2);
  const hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let bestV = 0;
    let bestJ = -1;
    for (let j = t - hi; j <= t - lo; j++) {
      if (j < 0) continue;
      const d = Math.log((t - j) / period);
      const v = C[j] - tightness * d * d;
      if (bestJ < 0 || v > bestV) {
        bestV = v;
        bestJ = j;
      }
    }
    C[t] = nov[t] + (bestJ >= 0 ? Math.max(0, bestV) : 0);
    back[t] = bestJ >= 0 && bestV > 0 ? bestJ : -1;
  }
  // best final beat within the last period
  let end = n - 1;
  for (let t = Math.max(0, n - Math.round(period)); t < n; t++) if (C[t] > C[end]) end = t;
  const beats: number[] = [];
  for (let t = end; t >= 0; t = back[t]) {
    beats.push(t);
    if (back[t] < 0) break;
  }
  beats.reverse();
  return beats;
}
