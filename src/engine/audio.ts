import type { Lane } from './types';

/**
 * All drum sounds are synthesized with WebAudio (oscillators + noise).
 * No samples, no assets — original sound design.
 */
export class DrumAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  ensure() {
    if (!this.ctx) {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.85;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 1.2);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** engine time in seconds (monotonic, same clock as the game) */
  time(): number {
    return this.ctx ? this.ctx.currentTime : performance.now() / 1000;
  }

  context(): AudioContext | null {
    return this.ctx;
  }

  /** create the context if needed and report its actual sample rate */
  sampleRate(): number {
    this.ensure();
    return this.ctx ? this.ctx.sampleRate : 44100;
  }

  /** seconds between scheduling a sound and the user actually hearing it */
  latencySec(): number {
    const c = this.ctx;
    if (!c) return 0;
    const out = typeof c.outputLatency === 'number' ? c.outputLatency : 0;
    const base = typeof c.baseLatency === 'number' ? c.baseLatency : 0;
    return out + base;
  }

  /** destination node for backing tracks */
  output(): AudioNode | null {
    return this.master ?? this.ctx?.destination ?? null;
  }

  private tone(
    t: number,
    type: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    vol: number,
  ) {
    if (!this.ctx || !this.master) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, f0), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(
    t: number,
    filterType: BiquadFilterType,
    freq: number,
    q: number,
    dur: number,
    vol: number,
  ) {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  /** metronome click */
  click(t: number, accent: boolean) {
    if (accent) {
      this.tone(t, 'sine', 1560, 1560, 0.05, 0.5);
    } else {
      this.tone(t, 'sine', 1000, 1000, 0.04, 0.32);
    }
  }

  hit(lane: Lane, t: number, vel = 1) {
    switch (lane) {
      case 'kick':
        this.tone(t, 'sine', 120, 42, 0.22, 0.95 * vel);
        break;
      case 'snare':
        this.tone(t, 'sine', 190, 150, 0.1, 0.45 * vel);
        this.noise(t, 'bandpass', 1900, 1.1, 0.16, 0.7 * vel);
        break;
      case 'hh':
        this.noise(t, 'highpass', 7600, 1, 0.07, 0.42 * vel);
        break;
      case 'tomLo':
        this.tone(t, 'sine', 170, 88, 0.32, 0.75 * vel);
        break;
      case 'tomHi':
        this.tone(t, 'sine', 260, 140, 0.26, 0.65 * vel);
        break;
      case 'crash':
        this.noise(t, 'highpass', 5200, 1, 0.95, 0.45 * vel);
        break;
    }
  }
}

/**
 * One AudioContext for the whole app: the engine's drum synth, backing-track
 * playback and the song loader's sample-rate probe must all agree.
 */
export const sharedAudio = new DrumAudio();
