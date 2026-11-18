/**
 * Offline instrument synthesis for the chart bench. Deliberately NOT the
 * app's drum synth: different kick/snare/hat designs, plus the instruments
 * that fool drum detectors in real mixes (bass plucks, distorted guitar
 * chugs, piano attacks, pads, a vocal-like lead).
 */

export const SR = 44100;

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RBJ cookbook biquad */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(type: 'lp' | 'hp' | 'bp', freq: number, q = 0.707) {
    this.set(type, freq, q);
  }
  set(type: 'lp' | 'hp' | 'bp', freq: number, q = 0.707) {
    const w = (2 * Math.PI * Math.min(freq, SR * 0.45)) / SR;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    let b0: number;
    let b1: number;
    let b2: number;
    if (type === 'lp') {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
    } else if (type === 'hp') {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
    } else {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    }
    const a0 = 1 + alpha;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

function span(out: Float32Array, t0: number, dur: number): [number, number] {
  const n0 = Math.max(0, Math.round(t0 * SR));
  const n1 = Math.min(out.length, n0 + Math.round(dur * SR));
  return [n0, n1];
}

// ───────────────────────────── drums ─────────────────────────────

export interface KickOpts {
  f0?: number;
  f1?: number;
  pitchDecay?: number;
  decay?: number;
  click?: number;
  drive?: number;
}

export function kick(out: Float32Array, t0: number, vel: number, r: () => number, o: KickOpts = {}) {
  const f0 = o.f0 ?? 150;
  const f1 = o.f1 ?? 50;
  const pd = o.pitchDecay ?? 0.03;
  const decay = o.decay ?? 0.22;
  const click = o.click ?? 0.35;
  const drive = o.drive ?? 1.6;
  const [n0, n1] = span(out, t0, decay * 5);
  const bp = new Biquad('bp', 3200, 1.2);
  let ph = 0;
  const norm = Math.tanh(drive);
  for (let n = n0; n < n1; n++) {
    const t = (n - n0) / SR;
    const f = f1 + (f0 - f1) * Math.exp(-t / pd);
    ph += (2 * Math.PI * f) / SR;
    let s = Math.sin(ph) * Math.exp(-t / decay);
    s = Math.tanh(drive * s) / norm;
    const c = bp.run(r() * 2 - 1) * Math.exp(-t / 0.005) * click;
    out[n] += vel * 0.9 * (s + c);
  }
}

export interface SnareOpts {
  tone1?: number;
  tone2?: number;
  toneDecay?: number;
  noiseDecay?: number;
  noiseHz?: number;
  toneMix?: number;
}

export function snare(out: Float32Array, t0: number, vel: number, r: () => number, o: SnareOpts = {}) {
  const t1 = o.tone1 ?? 185;
  const t2 = o.tone2 ?? 330;
  const td = o.toneDecay ?? 0.07;
  const nd = o.noiseDecay ?? 0.17;
  const nhz = o.noiseHz ?? 3800;
  const mix = o.toneMix ?? 0.5;
  const [n0, n1] = span(out, t0, nd * 5);
  const bp = new Biquad('bp', nhz, 0.6);
  const hp = new Biquad('hp', 900);
  for (let n = n0; n < n1; n++) {
    const t = (n - n0) / SR;
    const tone = (Math.sin(2 * Math.PI * t1 * t) + 0.6 * Math.sin(2 * Math.PI * t2 * t)) * Math.exp(-t / td);
    const nz = hp.run(bp.run(r() * 2 - 1)) * 2.2 * Math.exp(-t / nd);
    out[n] += vel * 0.7 * (mix * tone + (1 - mix) * nz);
  }
}

export function clap(out: Float32Array, t0: number, vel: number, r: () => number) {
  const [n0, n1] = span(out, t0, 0.6);
  const bp = new Biquad('bp', 1300, 0.9);
  for (let n = n0; n < n1; n++) {
    const t = (n - n0) / SR;
    let env = Math.exp(-t / 0.14);
    // three quick re-triggers, the classic hand-clap smear
    for (const d of [0, 0.011, 0.022]) if (t >= d && t < d + 0.009) env = Math.max(env, Math.exp(-(t - d) / 0.003));
    out[n] += vel * 1.4 * bp.run(r() * 2 - 1) * env;
  }
}

const METAL = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0];

export function hat(out: Float32Array, t0: number, vel: number, r: () => number, open = false, bright = 1) {
  const decay = open ? 0.32 : 0.045;
  const [n0, n1] = span(out, t0, decay * 5);
  const hp = new Biquad('hp', 7200 * bright, 0.8);
  const bp = new Biquad('bp', 10000 * bright, 0.9);
  const ph = METAL.map(() => r());
  for (let n = n0; n < n1; n++) {
    const t = (n - n0) / SR;
    let m = 0;
    for (let k = 0; k < METAL.length; k++) m += ((ph[k] + METAL[k] * 1.7 * t) % 1 < 0.5 ? 1 : -1);
    const s = hp.run(bp.run(m / 6 + (r() * 2 - 1) * 0.6));
    out[n] += vel * 0.55 * s * Math.exp(-t / decay);
  }
}

export function ride(out: Float32Array, t0: number, vel: number, r: () => number) {
  const [n0, n1] = span(out, t0, 1.6);
  const bp = new Biquad('bp', 6200, 1.2);
  for (let n = n0; n < n1; n++) {
    const t = (n - n0) / SR;
    let m = 0;
    for (let k = 0; k < METAL.length; k++) m += Math.sin(2 * Math.PI * METAL[k] * 4.1 * t + k);
    const ping = Math.sin(2 * Math.PI * 3150 * t) * Math.exp(-t / 0.35) * 0.4;
    const s = bp.run(m / 6 + (r() * 2 - 1) * 0.5) * Math.exp(-t / 0.55) + ping;
    out[n] += vel * 0.32 * (s + 0.6 * Math.exp(-t / 0.01) * (r() * 2 - 1));
  }
}

export function crash(out: Float32Array, t0: number, vel: number, r: () => number) {
  const [n0, n1] = span(out, t0, 2.5);
  const hp = new Biquad('hp', 3000, 0.7);
  const ph = METAL.map(() => r());
  for (let n = n0; n < n1; n++) {
    const t = (n - n0) / SR;
    let m = 0;
    for (let k = 0; k < METAL.length; k++) m += ((ph[k] + METAL[k] * 2.9 * t) % 1 < 0.5 ? 1 : -1);
    const env = Math.exp(-t / 0.9) * (1 - Math.exp(-t / 0.002));
    out[n] += vel * 0.5 * hp.run(m / 6 + (r() * 2 - 1)) * env;
  }
}

export function tom(out: Float32Array, t0: number, vel: number, r: () => number, f = 120) {
  const [n0, n1] = span(out, t0, 1.2);
  const bp = new Biquad('bp', 2500, 0.8);
  let ph = 0;
  for (let n = n0; n < n1; n++) {
    const t = (n - n0) / SR;
    const fr = f * (0.78 + 0.22 * Math.exp(-t / 0.05));
    ph += (2 * Math.PI * fr) / SR;
    out[n] += vel * 0.75 * (Math.sin(ph) * Math.exp(-t / 0.2) + bp.run(r() * 2 - 1) * 0.3 * Math.exp(-t / 0.02));
  }
}

// ─────────────────────────── harmonic ───────────────────────────

export const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

function saw(ph: number) {
  return 2 * (ph - Math.floor(ph + 0.5));
}

export function bass(out: Float32Array, t0: number, dur: number, midi: number, vel: number, cutoff = 700) {
  const f = hz(midi);
  const [n0, n1] = span(out, t0, dur + 0.08);
  const lp = new Biquad('lp', cutoff, 0.9);
  let ph = 0;
  for (let n = n0; n < n1; n++) {
    const t = (n - n0) / SR;
    if ((n - n0) % 32 === 0) lp.set('lp', 120 + cutoff * Math.exp(-t / 0.09), 0.9);
    ph += f / SR;
    const env = Math.min(1, t / 0.004) * (t < dur ? Math.exp(-t / 0.6) : Math.exp(-dur / 0.6) * Math.exp(-(t - dur) / 0.02));
    out[n] += vel * 0.55 * lp.run(saw(ph) + 0.5 * Math.sin(2 * Math.PI * ph)) * env;
  }
}

export function guitar(out: Float32Array, t0: number, dur: number, rootMidi: number, vel: number, mute = false) {
  const freqs = [hz(rootMidi), hz(rootMidi + 7), hz(rootMidi + 12)];
  const det = [1, 1.004, 0.997];
  const len = mute ? Math.min(dur, 0.16) : dur;
  const [n0, n1] = span(out, t0, len + 0.05);
  const lp = new Biquad('lp', mute ? 1600 : 4200, 0.8);
  const hp = new Biquad('hp', 90);
  const ph = new Float64Array(9);
  for (let n = n0; n < n1; n++) {
    const t = (n - n0) / SR;
    let s = 0;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        ph[i * 3 + j] += (freqs[i] * det[j]) / SR;
        s += saw(ph[i * 3 + j]);
      }
    }
    s = Math.tanh(s * 1.4) * 0.9;
    const env = Math.min(1, t / 0.003) * (mute ? Math.exp(-t / 0.07) : t < len ? 1 : Math.exp(-(t - len) / 0.015));
    out[n] += vel * 0.3 * hp.run(lp.run(s)) * env;
  }
}

export function keys(out: Float32Array, t0: number, dur: number, midis: number[], vel: number, r: () => number) {
  const [n0, n1] = span(out, t0, dur + 0.3);
  for (const m of midis) {
    const f = hz(m);
    for (let n = n0; n < n1; n++) {
      const t = (n - n0) / SR;
      let s = 0;
      for (let k = 1; k <= 8; k++) s += (Math.sin(2 * Math.PI * f * k * t) / k) * Math.exp(-t * (0.8 + k * 0.7));
      const rel = t < dur ? 1 : Math.exp(-(t - dur) / 0.08);
      out[n] += (vel * 0.18 * s * rel * Math.min(1, t / 0.002)) / Math.sqrt(midis.length);
    }
  }
  // hammer thump
  const [h0, h1] = span(out, t0, 0.02);
  for (let n = h0; n < h1; n++) out[n] += vel * 0.04 * (r() * 2 - 1) * Math.exp(-(n - h0) / SR / 0.004);
}

export function pad(out: Float32Array, t0: number, dur: number, midis: number[], vel: number) {
  const [n0, n1] = span(out, t0, dur + 0.6);
  const lp = new Biquad('lp', 1400, 0.7);
  const ph = new Float64Array(midis.length * 2);
  for (let n = n0; n < n1; n++) {
    const t = (n - n0) / SR;
    let s = 0;
    midis.forEach((m, i) => {
      ph[i * 2] += (hz(m) * 1.003) / SR;
      ph[i * 2 + 1] += (hz(m) * 0.997) / SR;
      s += saw(ph[i * 2]) + saw(ph[i * 2 + 1]);
    });
    const env = Math.min(1, t / 0.45) * (t < dur ? 1 : Math.exp(-(t - dur) / 0.25));
    out[n] += (vel * 0.07 * lp.run(s) * env) / Math.sqrt(midis.length);
  }
}

export function lead(out: Float32Array, t0: number, dur: number, midi: number, vel: number) {
  const f = hz(midi);
  const [n0, n1] = span(out, t0, dur + 0.1);
  const f1 = new Biquad('bp', 750, 2);
  const f2 = new Biquad('bp', 1250, 3);
  let ph = 0;
  for (let n = n0; n < n1; n++) {
    const t = (n - n0) / SR;
    ph += (f * (1 + 0.006 * Math.sin(2 * Math.PI * 5.5 * t))) / SR;
    const s = saw(ph);
    const env = Math.min(1, t / 0.06) * (t < dur ? 1 : Math.exp(-(t - dur) / 0.06));
    out[n] += vel * 0.35 * (f1.run(s) + 0.7 * f2.run(s)) * env;
  }
}

export function master(out: Float32Array) {
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = peak > 0 ? 1.25 / peak : 1;
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * g) * 0.89;
}
