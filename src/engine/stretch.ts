import { PitchShifter } from 'soundtouchjs';

/**
 * Resample a decoded buffer to the playback context rate.
 * decodeAudioData resamples to whatever context decodes it (44.1k here);
 * the playback context may run at 24/48k, and SoundTouch plays at
 * ctxRate/bufferRate speed when they mismatch — the "music sounds slow" bug.
 */
export async function fitToContext(buffer: AudioBuffer, sampleRate: number): Promise<AudioBuffer> {
  if (Math.abs(buffer.sampleRate - sampleRate) < 1) return buffer;
  const len = Math.max(1, Math.ceil(buffer.duration * sampleRate));
  const octx = new OfflineAudioContext(buffer.numberOfChannels, len, sampleRate);
  const src = octx.createBufferSource();
  src.buffer = buffer;
  src.connect(octx.destination);
  src.start(0);
  return await octx.startRendering();
}

/**
 * Backing-track player for custom songs.
 * Prefers pitch-preserving time-stretch (soundtouchjs ScriptProcessor);
 * falls back to plain playbackRate (pitch shifts with tempo) if that breaks.
 */
export class SongPlayer {
  private ctx: AudioContext;
  private buffer: AudioBuffer;
  private dest: AudioNode;
  private onEnd: () => void;
  private shifter: PitchShifter | null = null;
  private plain: AudioBufferSourceNode | null = null;
  private stretchOk = true;
  private useStretch = false;
  private rate = 1;
  private posSec = 0; // accumulated playhead in buffer seconds
  private anchorCtx = 0; // ctx time when current segment started
  private playing = false;
  private endedCbFired = false;

  constructor(ctx: AudioContext, buffer: AudioBuffer, dest: AudioNode, onEnd: () => void) {
    this.ctx = ctx;
    this.buffer = buffer;
    this.dest = dest;
    this.onEnd = onEnd;
  }

  get position(): number {
    if (!this.playing) return this.posSec;
    if (this.shifter) return this.shifter.timePlayed;
    if (this.plain) return this.posSec + (this.ctx.currentTime - this.anchorCtx) * this.rate;
    return this.posSec;
  }

  get ended(): boolean {
    return this.endedCbFired;
  }

  get duration(): number {
    return this.buffer.duration;
  }

  private fireEnd() {
    if (!this.endedCbFired) {
      this.endedCbFired = true;
      this.onEnd();
    }
  }

  /** start (or restart) playback from the current playhead, immediately */
  start() {
    this.stopNodes();
    this.playing = true;
    this.endedCbFired = false;
    const pos = Math.min(this.posSec, Math.max(0, this.buffer.duration - 0.05));

    // Plain AudioBufferSourceNode: WebAudio resamples correctly and plays at
    // exactly 1× wall clock. SoundTouchJS (ScriptProcessor) measured ~1.11×
    // speed drift even at tempo 1 — not acceptable for a rhythm game, so the
    // stretch path stays opt-in only.
    if (!this.useStretch) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.buffer;
      src.playbackRate.value = this.rate;
      src.connect(this.dest);
      src.onended = () => this.fireEnd();
      src.start(0, pos);
      this.anchorCtx = this.ctx.currentTime;
      this.posSec = pos;
      this.plain = src;
      return;
    }

    if (this.stretchOk) {
      try {
        this.shifter = new PitchShifter(this.ctx, this.buffer, 4096, () => this.fireEnd());
        // SoundTouch consumes samples at the ctx rate; compensate if rates differ
        const srFix = this.buffer.sampleRate / this.ctx.sampleRate;
        this.shifter.tempo = this.rate * srFix;
        this.shifter.percentagePlayed = (pos / this.buffer.duration) * 100;
        this.shifter.connect(this.dest);
        return;
      } catch {
        this.stretchOk = false; // ScriptProcessor unavailable — fall back
        this.shifter = null;
      }
    }

    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this.rate;
    src.connect(this.dest);
    src.onended = () => this.fireEnd();
    src.start(0, pos);
    this.anchorCtx = this.ctx.currentTime;
    this.posSec = pos;
    this.plain = src;
  }

  pause() {
    if (!this.playing) return;
    this.posSec = this.position;
    this.stopNodes();
    this.playing = false;
  }

  resume() {
    if (this.playing) return;
    this.start();
  }

  seek(sec: number) {
    const pos = Math.max(0, Math.min(sec, this.buffer.duration));
    if (this.playing) {
      this.posSec = pos;
      this.start();
    } else {
      this.posSec = pos;
    }
  }

  setTempo(r: number) {
    if (this.plain) {
      // rebase position accounting at the OLD rate first (position() uses
      // this.rate), then switch; otherwise the playhead jumps on every change
      this.posSec = this.position;
      this.anchorCtx = this.ctx.currentTime;
      this.plain.playbackRate.value = r;
    }
    this.rate = r;
    if (this.shifter) this.shifter.tempo = r;
  }

  stop() {
    this.posSec = this.position;
    this.stopNodes();
    this.playing = false;
  }

  private stopNodes() {
    try {
      this.shifter?.disconnect();
    } catch {
      // ignore
    }
    this.shifter = null;
    try {
      this.plain?.stop();
    } catch {
      // ignore
    }
    this.plain = null;
  }
}
