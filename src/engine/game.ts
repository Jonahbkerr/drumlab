import { sharedAudio } from './audio';
import type { Lane, Lesson, Note, Section } from './types';
import { LANES, LANE_LABEL } from './types';
import { GOOD_MS, JUDGE_SCORE, judgeDelta, starsForAccuracy } from './judge';
import type { Judgement } from './judge';
import type { SongChart } from './transcribe';
import { SongPlayer } from './stretch';

export type Phase = 'idle' | 'countin' | 'playing' | 'done';
export type GameMode = 'performance' | 'practice';

export interface Hud {
  phase: Phase;
  mode: GameMode;
  paused: boolean;
  accuracy: number;
  combo: number;
  maxCombo: number;
  score: number;
  notesDone: number;
  notesTotal: number;
  bpm: number;
  bpmMul: number;
  speed: number;
  sectionIndex: number; // -1 = whole song
  waitMode: boolean;
  metronome: boolean;
  countBeat: number;
  lastJudge: { j: Judgement; lane: Lane } | null;
  seconds: number;
}

export interface RunResult {
  lessonId: string;
  mode: GameMode;
  total: number;
  hits: number;
  misses: number;
  perfects: number;
  greats: number;
  goods: number;
  score: number;
  accuracy: number;
  maxCombo: number;
  earlyCount: number;
  lateCount: number;
  earlySumMs: number;
  lateSumMs: number;
  perLane: Record<Lane, { hit: number; miss: number }>;
  completed: boolean;
  seconds: number;
}

const LANE_COLOR: Record<Lane, string> = {
  kick: '#ff6a3d',
  snare: '#ffc53d',
  hh: '#4cc9f0',
  tomLo: '#a78bfa',
  tomHi: '#f472b6',
  crash: '#34d399',
};

function hexA(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

interface FloatText {
  text: string;
  color: string;
  x: number;
  at: number;
}

/** one hit (or miss) animation at a lane's target */
interface HitEffect {
  lane: Lane;
  at: number;
  judge: Judgement;
  /** seconds; negative = early */
  delta: number;
  seed: number;
}

const JUDGE_COLOR: Record<Judgement, string> = {
  perfect: '#ffd166',
  great: '#4cc9f0',
  good: '#34d399',
  miss: '#f87171',
};
const EFFECT_LIFE = 0.55;

const HIT_LINE_OFFSET = 148; // px from bottom of canvas
const PX_PER_BEAT = 170;
const PX_PER_SEC = 190;

interface Anchor {
  beat: number; // note-space position (lesson beats or song seconds)
  musicBeat: number; // metronome-space position (beats)
  time: number; // engine time
}

export class GameEngine {
  private audio = sharedAudio;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private raf = 0;
  private lastFrame = 0;

  private lesson: Lesson | null = null;
  private songMode = false;
  private chart: SongChart | null = null;
  private buffer: AudioBuffer | null = null;
  private player: SongPlayer | null = null;
  private backingDone = false;

  private mode: GameMode = 'performance';
  private notes: Note[] = [];
  private judged: (Judgement | null)[] = []; // null = pending
  private deltas: number[] = [];

  private phase: Phase = 'idle';
  private paused = false;
  private pauseReason: 'user' | 'wait' = 'user';
  private waitIdx = -1;

  private startCtx = 0;
  private anchor: Anchor = { beat: 0, musicBeat: 0, time: 0 };
  private anchorPos = 0; // SongPlayer position at the anchor moment
  private bpmMul = 1;
  private speed = 1;
  private section: Section | null = null;
  private waitMode = false;
  private metronome = true;
  private lastBeatInt = -Infinity;
  /** song mode with tracked beats: count-in + metronome follow the music */
  private clicks: { t: number; accent: boolean; countIn: boolean }[] = [];
  private clickIdx = 0;
  private countInEnd = 0;
  /** audio-clock time the run was paused at (lessons and count-ins stop their clock) */
  private pausedAt: number | null = null;

  private hits = 0;
  private misses = 0;
  private perfects = 0;
  private greats = 0;
  private goods = 0;
  private score = 0;
  private combo = 0;
  private maxCombo = 0;
  private weightSum = 0;
  private earlyCount = 0;
  private lateCount = 0;
  private earlySumMs = 0;
  private lateSumMs = 0;
  private laneHit: Record<Lane, number> = this.emptyLaneCount();
  private laneMiss: Record<Lane, number> = this.emptyLaneCount();
  private playSeconds = 0;
  private lastHudAt = 0;

  private floats: FloatText[] = [];
  private effects: HitEffect[] = [];
  private effectSeed = 1;
  /** last combo milestone shown (every 10) */
  private comboShown = 0;
  private flashTimes: Partial<Record<Lane, number>> = {};

  onHud: (h: Hud) => void = () => {};
  onResult: (r: RunResult) => void = () => {};
  onFlash: (lane: Lane) => void = () => {};

  private emptyLaneCount(): Record<Lane, number> {
    return { kick: 0, snare: 0, hh: 0, tomLo: 0, tomHi: 0, crash: 0 };
  }

  /** note-space seconds per note unit (beats for lessons, seconds for songs) */
  private get spb(): number {
    if (this.songMode) return 1 / this.bpmMul;
    return 60 / ((this.lesson?.bpm ?? 100) * this.bpmMul);
  }

  /** metronome beats per second */
  private get clickSpb(): number {
    if (this.songMode) return 60 / ((this.chart?.bpm ?? 120) * this.bpmMul);
    return this.spb;
  }

  private now(): number {
    // Song mode: the game clock IS the backing track's playhead — minus the
    // output latency, because that is where the sound the user HEARS is.
    // Otherwise the highway runs one device-latency ahead of the music
    // (10ms onboard, 100–300ms Bluetooth) and everything feels "off".
    if (this.songMode && this.player && this.phase !== 'countin') {
      // position is in song seconds; at a practice tempo it advances slower
      // than real time, so scale back to real seconds (spb = 1 / tempo)
      const raw = this.anchor.time + (this.player.position - this.anchorPos) * this.spb;
      return Math.max(0, raw - this.calOffset());
    }
    // Lessons: same idea. Clicks and pad sounds reach the ears one output
    // latency after they are rendered, so the lesson clock runs that much
    // behind the render clock (song count-ins stay on the raw clock).
    const lag = this.songMode ? 0 : this.calOffset();
    return (this.pausedAt ?? this.audio.time()) - this.startCtx - lag;
  }

  private freezeClock() {
    this.pausedAt ??= this.audio.time();
  }

  /** continue the audio-clock timeline from where it was frozen */
  private unfreezeClock() {
    if (this.pausedAt === null) return;
    this.startCtx += this.audio.time() - this.pausedAt;
    this.pausedAt = null;
  }

  /** manual calibration override (seconds); null = use device latency */
  private calMs: number | null = null;

  setCalibration(ms: number | null) {
    this.calMs = ms;
  }

  private calOffset(): number {
    if (this.calMs !== null) return this.calMs / 1000;
    return this.audio.latencySec();
  }

  private beatNow(): number {
    return this.anchor.beat + (this.now() - this.anchor.time) / this.spb;
  }

  private musicBeatNow(): number {
    return this.anchor.musicBeat + (this.now() - this.anchor.time) / this.clickSpb;
  }

  private musicBeatFor(noteT: number): number {
    if (this.songMode) return (noteT * (this.chart?.bpm ?? 120)) / 60;
    return noteT;
  }

  private get beatSync(): boolean {
    return this.songMode && (this.chart?.beats?.length ?? 0) > 8;
  }

  /** clicks scheduled ahead on the audio clock (lessons and beat-tracked songs) */
  private get usesClickList(): boolean {
    return this.beatSync || !this.songMode;
  }

  /** lesson count-in and metronome: one click per beat, beat 0 = bar 1 */
  private prepareLessonClicks() {
    const lesson = this.lesson!;
    const n = lesson.countInBeats;
    this.clicks = [];
    for (let b = -n; b <= lesson.totalBeats; b++) {
      this.clicks.push({ t: b, accent: ((b % 4) + 4) % 4 === 0, countIn: b < 0 });
    }
    this.clickIdx = 0;
  }

  /**
   * Clicks on the song's tracked beats: a count-in into the first bar at or
   * after `from`, then one per beat (accent on bar starts). Returns how long
   * (song seconds) the count-in must run before `from`.
   */
  private prepareClicks(from: number): number {
    const chart = this.chart!;
    const beats = chart.beats!;
    const down = chart.downbeat ?? 0;
    const p = 60 / chart.bpm;
    const n = chart.countInBeats;
    let target = -1;
    for (let i = down; i < beats.length; i += 4) {
      if (beats[i] >= from - 0.02) {
        target = beats[i];
        break;
      }
    }
    if (target < 0) target = from + n * p;
    const ticks = Array.from({ length: n }, (_, k) => ({ t: target - (n - k) * p, accent: k === 0, countIn: true }));
    const music = beats
      .map((t, i) => ({ t, accent: (((i - down) % 4) + 4) % 4 === 0, countIn: false }))
      .filter((c) => c.t >= target - 0.02);
    this.clicks = [...ticks, ...music];
    this.clickIdx = 0;
    return Math.max(0, from - ticks[0].t);
  }

  /** schedule clicks due in the next ~100 ms on the audio clock */
  private tickClicks() {
    const pos = this.beatNow();
    // the clock subtracts the output latency, so clicks render that much early
    // and are heard exactly on the beat (song count-ins run on the raw clock)
    const lag = this.songMode && this.phase !== 'playing' ? 0 : this.calOffset();
    while (this.clickIdx < this.clicks.length) {
      const c = this.clicks[this.clickIdx];
      const dt = (c.t - pos) * this.spb - lag; // real seconds until the click must sound
      if (dt > 0.1) break;
      this.clickIdx++;
      if (dt < -0.05) continue; // already past (seek, pause)
      if (c.countIn || this.metronome) this.audio.click(this.audio.time() + Math.max(0, dt), c.accent);
    }
  }

  /** skip clicks before a song position (after loops/seeks) */
  private seekClicks(pos: number) {
    this.clickIdx = this.clicks.findIndex((c) => !c.countIn && c.t >= pos - 0.01);
    if (this.clickIdx < 0) this.clickIdx = this.clicks.length;
  }

  /** 1–4 while a beat-synced count-in is sounding, else 0 */
  private syncCount(): number {
    if (!this.beatSync) return 0;
    const ticks = this.clicks.filter((c) => c.countIn);
    if (ticks.length === 0) return 0;
    const pos = this.beatNow();
    const p = 60 / (this.chart?.bpm ?? 120);
    if (pos < ticks[0].t - p * 0.25 || pos >= ticks[ticks.length - 1].t + p) return 0;
    return Math.max(1, ticks.filter((c) => c.t <= pos + 0.02).length);
  }

  private noteTime(i: number): number {
    return this.anchor.time + (this.notes[i].t - this.anchor.beat) * this.spb;
  }

  /** shift anchor so the current position keeps its wall-clock time */
  private reAnchor() {
    if (this.songMode && this.player && this.phase === 'playing') {
      // Song clock: move the anchor along the raw playhead. now() and
      // beatNow() subtract the output latency themselves; folding the
      // already-compensated position into the anchor would subtract it again
      // on every pause/resume/tempo change and push the notes later each time.
      const pos = this.player.position;
      this.anchor = {
        beat: this.anchor.beat + (pos - this.anchorPos),
        musicBeat: this.musicBeatNow(),
        time: this.anchor.time + (pos - this.anchorPos) * this.spb,
      };
      this.anchorPos = pos;
      return;
    }
    const t = this.now();
    const beat = this.beatNow();
    const musicBeat = this.musicBeatNow();
    this.anchorPos = this.player?.position ?? 0;
    this.anchor = { beat, musicBeat, time: t };
  }

  load(
    lesson: Lesson,
    mode: GameMode,
    opts: { sectionIndex?: number; bpmMul?: number; waitMode?: boolean; speed?: number } = {},
  ) {
    this.lesson = lesson;
    this.songMode = false;
    this.chart = null;
    this.buffer = null;
    this.player = null;
    this.backingDone = false;
    this.mode = mode;
    this.bpmMul = opts.bpmMul ?? 1;
    this.speed = opts.speed ?? 1;
    this.waitMode = opts.waitMode ?? false;
    const secIdx = opts.sectionIndex ?? -1;
    const sec = secIdx >= 0 ? lesson.sections[secIdx] : undefined;
    this.section = mode === 'practice' && sec ? sec : null;
    this.notes = this.section
      ? lesson.notes.filter((nn) => nn.t >= this.section!.start && nn.t < this.section!.end)
      : [...lesson.notes];
    this.notes.sort((a, b) => a.t - b.t);
    this.resetRun();
  }

  loadSong(
    chart: SongChart,
    buffer: AudioBuffer,
    mode: GameMode,
    opts: { sectionIndex?: number; bpmMul?: number; waitMode?: boolean; speed?: number } = {},
  ) {
    this.lesson = null;
    this.songMode = true;
    this.chart = chart;
    this.buffer = buffer;
    this.player = null;
    this.backingDone = false;
    this.mode = mode;
    this.bpmMul = opts.bpmMul ?? 1;
    this.speed = opts.speed ?? 1;
    this.waitMode = opts.waitMode ?? false;
    const secIdx = opts.sectionIndex ?? -1;
    const sec = secIdx >= 0 ? chart.sections[secIdx] : undefined;
    this.section = mode === 'practice' && sec ? sec : null;
    this.notes = this.section
      ? chart.notes.filter((nn) => nn.t >= this.section!.start && nn.t < this.section!.end)
      : [...chart.notes];
    this.notes.sort((a, b) => a.t - b.t);
    this.resetRun();
  }

  private resetRun() {
    this.judged = this.notes.map(() => null);
    this.deltas = [];
    this.phase = 'idle';
    this.paused = false;
    this.pausedAt = null;
    this.waitIdx = -1;
    this.lastBeatInt = -Infinity;
    this.hits = 0;
    this.misses = 0;
    this.perfects = 0;
    this.greats = 0;
    this.goods = 0;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.weightSum = 0;
    this.earlyCount = 0;
    this.lateCount = 0;
    this.earlySumMs = 0;
    this.lateSumMs = 0;
    this.laneHit = this.emptyLaneCount();
    this.laneMiss = this.emptyLaneCount();
    this.playSeconds = 0;
    this.floats = [];
    this.effects = [];
    this.comboShown = 0;
    this.flashTimes = {};
  }

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  start() {
    if ((!this.lesson && !this.chart) || this.notes.length === 0) return;
    this.audio.ensure();
    this.startCtx = this.audio.time();
    const countInBeats = this.songMode ? this.chart!.countInBeats : this.lesson!.countInBeats;
    if (this.beatSync) {
      const from = this.section?.start ?? 0;
      const lead = this.prepareClicks(from);
      this.countInEnd = from;
      this.anchor = { beat: from - lead, musicBeat: 0, time: 0 };
    } else {
      this.anchor = { beat: 0, musicBeat: 0, time: countInBeats * this.clickSpb };
      if (!this.songMode) this.prepareLessonClicks();
    }
    this.anchorPos = 0;
    this.phase = 'countin';
    this.paused = false;
    this.pausedAt = null;
    this.backingDone = false;
    this.player?.stop();
    this.player = null;
    if (this.songMode && this.buffer) {
      const dest = this.audio.output();
      const actx = this.audio.context();
      if (dest && actx) {
        this.player = new SongPlayer(actx, this.buffer, dest, () => {
          this.backingDone = true;
        });
      }
    }
    this.lastFrame = performance.now();
    this.lastHudAt = 0;
    cancelAnimationFrame(this.raf);
    const loop = (ms: number) => {
      this.update(ms);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.player?.stop();
    this.player = null;
    this.phase = 'idle';
  }

  setBpmMul(m: number) {
    // anchor first, while the old tempo still describes the time played so far
    this.reAnchor();
    this.bpmMul = Math.min(1.2, Math.max(0.5, m));
    if (this.player) this.player.setTempo(this.bpmMul);
    if (this.songMode && this.player) this.anchorPos = this.player.position;
  }

  setSpeed(s: number) {
    this.speed = Math.min(1.6, Math.max(0.6, s));
  }

  setSection(index: number) {
    if (this.mode !== 'practice' || this.phase === 'idle') return;
    const source = this.songMode ? this.chart?.sections : this.lesson?.sections;
    const allNotes = this.songMode ? this.chart?.notes ?? [] : this.lesson?.notes ?? [];
    const sec = index >= 0 ? source?.[index] : undefined;
    this.section = sec ?? null;
    this.notes = this.section
      ? allNotes.filter((nn) => nn.t >= this.section!.start && nn.t < this.section!.end)
      : [...allNotes];
    this.notes.sort((a, b) => a.t - b.t);
    this.judged = this.notes.map(() => null);
    this.reAnchor();
    if (this.player && this.section) this.player.seek(this.section.start);
    if (this.usesClickList && this.section) this.seekClicks(this.section.start);
    this.pushHud(true);
  }

  setWaitMode(on: boolean) {
    this.waitMode = on;
    if (this.paused && this.pauseReason === 'wait' && !on) this.resume();
  }

  setMetronome(on: boolean) {
    this.metronome = on;
  }

  pause() {
    if (this.phase !== 'countin' && this.phase !== 'playing') return;
    this.paused = true;
    this.pauseReason = 'user';
    this.freezeClock();
    if (this.phase === 'playing') this.player?.pause();
    this.pushHud(true);
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.waitIdx = -1;
    this.unfreezeClock();
    this.reAnchor();
    if (this.phase === 'playing') this.player?.resume();
    this.pushHud(true);
  }

  /**
   * Called for every input event: pads, keyboard, MIDI. `at` is the input
   * event's timestamp (performance.now() ms): the hit is judged at that
   * instant, not when the busy main thread got round to handling it.
   */
  hit(lane: Lane, vel = 1, at?: number) {
    if ((!this.lesson && !this.chart) || this.phase === 'idle' || this.phase === 'done') return;
    const queued = at === undefined ? 0 : Math.min(0.1, Math.max(0, (performance.now() - at) / 1000));
    const now = this.now() - queued;
    // the pad sound plays right now on the audio clock (now() is the song clock)
    this.audio.hit(lane, this.audio.time(), vel);
    this.flashTimes[lane] = now;
    this.onFlash(lane);

    // the count-in hands over to play on the next frame; a hit on (or just
    // before) the first beat must still count
    if (this.phase !== 'playing' && this.phase !== 'countin') return;
    if (this.paused) {
      if (this.pauseReason === 'wait' && this.notes[this.waitIdx]?.lane === lane) {
        this.paused = false;
        this.unfreezeClock();
        const t = this.notes[this.waitIdx].t;
        this.anchor = { beat: t, musicBeat: this.musicBeatFor(t), time: now };
        this.waitIdx = -1;
        if (this.songMode && this.player) {
          // restart the music at the note that was waited for
          this.player.seek(t);
          this.anchorPos = t;
          if (this.beatSync) this.seekClicks(t);
        }
        this.player?.resume();
      } else {
        return;
      }
    }

    let best = -1;
    let bestAbs = Infinity;
    for (let i = 0; i < this.notes.length; i++) {
      if (this.judged[i] !== null || this.notes[i].lane !== lane) continue;
      const d = Math.abs(this.noteTime(i) - now);
      if (d <= GOOD_MS && d < bestAbs) {
        best = i;
        bestAbs = d;
      }
    }
    if (best === -1) return; // ghost hit — sound played, no judge

    const delta = now - this.noteTime(best);
    const j = judgeDelta(delta);
    this.judged[best] = j;
    this.deltas[best] = delta;
    this.hits++;
    this.laneHit[lane]++;
    if (j === 'perfect') this.perfects++;
    else if (j === 'great') this.greats++;
    else this.goods++;
    const mult = 1 + Math.min(1, Math.floor(this.combo / 10) * 0.1);
    this.score += Math.round(JUDGE_SCORE[j] * mult);
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const w = j === 'perfect' ? 1 : j === 'great' ? 0.7 : 0.4;
    this.weightSum += w;
    const ms = delta * 1000;
    if (delta < 0) {
      this.earlyCount++;
      this.earlySumMs += -ms;
    } else if (delta > 0) {
      this.lateCount++;
      this.lateSumMs += ms;
    }
    const shownAt = this.now();
    this.effects.push({ lane, at: shownAt, judge: j, delta, seed: this.effectSeed++ });
    if (this.combo >= 10 && this.combo % 10 === 0 && this.combo !== this.comboShown) {
      this.comboShown = this.combo;
      this.floats.push({ text: `${this.combo} COMBO`, color: '#ffd166', x: 0.5, at: shownAt });
    }
    this.pushHud(false);
  }

  private judgeMiss(i: number) {
    this.judged[i] = 'miss';
    this.misses++;
    this.laneMiss[this.notes[i].lane]++;
    this.combo = 0;
    this.comboShown = 0;
    this.effects.push({ lane: this.notes[i].lane, at: this.now(), judge: 'miss', delta: 0, seed: this.effectSeed++ });
  }

  private finish() {
    this.phase = 'done';
    this.player?.stop();
    this.player = null;
    const total = this.notes.length;
    const accuracy = total > 0 ? this.weightSum / total : 0;
    const id = this.songMode && this.chart ? this.chart.id : (this.lesson?.id ?? 'lesson');
    const result: RunResult = {
      lessonId: id,
      mode: this.mode,
      total,
      hits: this.hits,
      misses: this.misses,
      perfects: this.perfects,
      greats: this.greats,
      goods: this.goods,
      score: this.score,
      accuracy,
      maxCombo: this.maxCombo,
      earlyCount: this.earlyCount,
      lateCount: this.lateCount,
      earlySumMs: this.earlySumMs,
      lateSumMs: this.lateSumMs,
      perLane: Object.fromEntries(
        LANES.map((l) => [l, { hit: this.laneHit[l], miss: this.laneMiss[l] }]),
      ) as RunResult['perLane'],
      completed: accuracy >= 0.6,
      seconds: this.playSeconds,
    };
    this.pushHud(true);
    this.onResult(result);
  }

  private update(ms: number) {
    if (!this.lesson && !this.chart) return;
    const frameSec = Math.min(0.1, (ms - this.lastFrame) / 1000);
    this.lastFrame = ms;
    const now = this.now();

    if (this.phase === 'countin') {
      if (this.beatSync) {
        this.tickClicks();
        if (this.beatNow() >= this.countInEnd) {
          this.phase = 'playing';
          if (this.player) {
            if (this.countInEnd > 0) this.player.seek(this.countInEnd);
            this.player.start();
            this.anchorPos = this.player.position;
          }
          this.anchor = { beat: this.countInEnd, musicBeat: 0, time: now };
          this.pushHud(true);
        }
      } else {
        const beat = this.musicBeatNow();
        if (this.usesClickList) this.tickClicks();
        else this.countInClick(beat, now);
        if (beat >= 0) {
          this.phase = 'playing';
          this.player?.start();
          this.pushHud(true);
        }
      }
    } else if (this.phase === 'playing' && !this.paused) {
      this.playSeconds += frameSec;
      if (this.usesClickList) this.tickClicks();
      else this.countInClick(this.musicBeatNow(), now);

      // loop jump (practice mode with a section selected)
      if (this.section && this.beatNow() >= this.section.end) {
        this.anchor = {
          beat: this.section.start,
          musicBeat: this.musicBeatFor(this.section.start),
          time: now,
        };
        this.judged = this.notes.map(() => null);
        if (this.player) {
          this.player.seek(this.section.start);
          this.anchorPos = this.player.position;
        } else {
          this.anchorPos = 0;
        }
        if (this.usesClickList) this.seekClicks(this.section.start);
        this.pushHud(true);
      }

      // miss detection + wait mode
      for (let i = 0; i < this.notes.length; i++) {
        if (this.judged[i] !== null) continue;
        if (this.noteTime(i) < now - GOOD_MS) {
          if (this.waitMode && !this.section) {
            this.judgeMiss(i);
            this.paused = true;
            this.pauseReason = 'wait';
            this.freezeClock();
            this.waitIdx = i;
            this.player?.pause();
            this.floats.push({ text: 'WAIT…', color: '#f87171', x: 0.5, at: now });
            this.pushHud(true);
            break;
          }
          this.judgeMiss(i);
        }
      }

      // song finished?
      const pending = this.judged.some((j) => j === null);
      if (!pending && !this.section) {
        const lastT = this.noteTime(this.notes.length - 1);
        const tail = this.songMode ? 1.5 : 1.2;
        if ((this.songMode && this.backingDone) || now > lastT + tail) {
          this.finish();
          return;
        }
      }
    }

    this.draw(now);
    if (now - this.lastHudAt > 0.1) {
      this.lastHudAt = now;
      this.pushHud(false);
    }
  }

  private countInClick(beat: number, now: number) {
    const bi = Math.floor(beat);
    if (bi !== this.lastBeatInt) {
      this.lastBeatInt = bi;
      if (this.phase === 'countin') {
        this.audio.click(now, bi % 4 === 0);
      } else if (this.metronome && bi >= 0) {
        this.audio.click(now, bi % 4 === 0);
      }
    }
  }

  private pushHud(force: boolean) {
    if (!this.lesson && !this.chart) return;
    if (!force && this.phase === 'playing' && this.paused) return;
    const judgedCount = this.judged.filter((j) => j !== null).length;
    const baseBpm = this.songMode ? (this.chart?.bpm ?? 120) : (this.lesson?.bpm ?? 100);
    const countInBeats = this.songMode ? (this.chart?.countInBeats ?? 4) : (this.lesson?.countInBeats ?? 4);
    this.onHud({
      phase: this.phase,
      mode: this.mode,
      paused: this.paused,
      accuracy: judgedCount > 0 ? this.weightSum / judgedCount : 0,
      combo: this.combo,
      maxCombo: this.maxCombo,
      score: this.score,
      notesDone: judgedCount,
      notesTotal: this.notes.length,
      bpm: Math.round(baseBpm * this.bpmMul),
      bpmMul: this.bpmMul,
      speed: this.speed,
      sectionIndex: this.section
        ? ((this.songMode ? this.chart?.sections : this.lesson?.sections)?.findIndex(
            (s) => s.start === this.section!.start && s.end === this.section!.end,
          ) ?? -1)
        : -1,
      waitMode: this.waitMode,
      metronome: this.metronome,
      countBeat: this.beatSync
        ? this.syncCount()
        : this.phase === 'countin'
          ? Math.max(1, Math.floor(this.musicBeatNow()) + countInBeats + 1)
          : 0,
      lastJudge: null,
      seconds: this.playSeconds,
    });
  }

  // ---------------------------------------------------------------- render

  private draw(now: number) {
    const canvas = this.canvas;
    const ctx = this.ctx;
    if (!canvas || !ctx || (!this.lesson && !this.chart)) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const laneW = w / LANES.length;
    const hitY = h - HIT_LINE_OFFSET;
    const pxPerSec = this.songMode
      ? PX_PER_SEC * this.speed
      : (PX_PER_BEAT * (this.lesson!.bpm * this.bpmMul)) / 60 * this.speed;

    // lanes
    for (let i = 0; i < LANES.length; i++) {
      const x = i * laneW;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.028)' : 'rgba(255,255,255,0.012)';
      ctx.fillRect(x, 0, laneW, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // beat grid from the song's tracked beats: bar lines brighter
    if (this.beatSync) {
      const beats = this.chart!.beats!;
      const down = this.chart!.downbeat ?? 0;
      for (let i = 0; i < beats.length; i++) {
        const t = this.anchor.time + (beats[i] - this.anchor.beat) * this.spb;
        const y = hitY - (t - now) * pxPerSec;
        if (y > hitY) continue;
        if (y < -4) break;
        const bar = (((i - down) % 4) + 4) % 4 === 0;
        ctx.fillStyle = bar ? 'rgba(255,255,255,0.17)' : 'rgba(255,255,255,0.06)';
        ctx.fillRect(0, y - (bar ? 1 : 0.5), w, bar ? 2 : 1);
      }
    }

    // connector glow: lane → pad
    for (let i = 0; i < LANES.length; i++) {
      const cx = i * laneW + laneW / 2;
      const g = ctx.createLinearGradient(0, hitY, 0, h);
      g.addColorStop(0, hexA(LANE_COLOR[LANES[i]], 0.16));
      g.addColorStop(1, hexA(LANE_COLOR[LANES[i]], 0.02));
      ctx.fillStyle = g;
      ctx.fillRect(cx - 3, hitY, 6, h - hitY);
    }

    // hit line + targets
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(0, hitY - 1.5, w, 3);
    ctx.shadowColor = 'rgba(255,255,255,0.35)';
    ctx.shadowBlur = 8;
    ctx.fillRect(0, hitY - 1.5, w, 3);
    ctx.shadowBlur = 0;
    for (let i = 0; i < LANES.length; i++) {
      const lane = LANES[i];
      const cx = i * laneW + laneW / 2;
      const flash = this.flashTimes[lane];
      const hot = flash !== undefined && now - flash < 0.12;
      ctx.beginPath();
      ctx.arc(cx, hitY, 34, 0, Math.PI * 2);
      ctx.strokeStyle = LANE_COLOR[lane];
      ctx.globalAlpha = hot ? 0.95 : 0.45;
      ctx.lineWidth = hot ? 4 : 2;
      ctx.stroke();
      if (hot) {
        ctx.fillStyle = LANE_COLOR[lane];
        ctx.globalAlpha = 0.22;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
    }

    // notes
    const horizon = (hitY + 60) / pxPerSec;
    for (let i = 0; i < this.notes.length; i++) {
      const note = this.notes[i];
      const t = this.noteTime(i);
      const y = hitY - (t - now) * pxPerSec;
      if (y < -40 || t < now - horizon) continue;
      const laneIdx = LANES.indexOf(note.lane);
      const x = laneIdx * laneW + laneW * 0.14;
      const j = this.judged[i];
      if (j === 'miss') {
        // the missed note keeps falling past the line as a fading ✕
        const fade = 1 - (now - t) / 0.5;
        if (fade <= 0) continue;
        ctx.globalAlpha = 0.7 * Math.min(1, fade);
        ctx.strokeStyle = '#f87171';
        ctx.lineWidth = 3;
        const cx = laneIdx * laneW + laneW / 2;
        const cy = y;
        const s = 8;
        ctx.beginPath();
        ctx.moveTo(cx - s, cy - s);
        ctx.lineTo(cx + s, cy + s);
        ctx.moveTo(cx + s, cy - s);
        ctx.lineTo(cx - s, cy + s);
        ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }
      if (j !== null) continue; // hit notes vanish
      ctx.fillStyle = LANE_COLOR[note.lane];
      ctx.shadowColor = LANE_COLOR[note.lane];
      ctx.shadowBlur = 14;
      const r = 7;
      ctx.beginPath();
      ctx.roundRect(x, y - 9, laneW * 0.72, 18, r);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    this.drawEffects(ctx, now, laneW, hitY, h);

    // floating texts (combo milestones, wait prompts)
    this.floats = this.floats.filter((f) => now - f.at < 0.8);
    for (const f of this.floats) {
      const age = now - f.at;
      // above the lane judgments, so the two never overlap
      const y = hitY - 150 - age * 60;
      ctx.globalAlpha = age < 0.35 ? 1 : 1 - (age - 0.35) / 0.45;
      ctx.fillStyle = f.color;
      ctx.font = '800 26px "Avenir Next", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(f.text, w / 2, y);
      ctx.globalAlpha = 1;
    }

    // count-in (beat-synced songs count in over the intro, into bar 1)
    const syncK = this.syncCount();
    if (this.phase === 'countin' || syncK > 0) {
      const countInBeats = this.songMode ? (this.chart?.countInBeats ?? 4) : (this.lesson?.countInBeats ?? 4);
      const k = syncK > 0 ? syncK : Math.min(
        countInBeats,
        Math.max(1, Math.floor(this.musicBeatNow()) + countInBeats + 1),
      );
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = '800 72px "Avenir Next", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(k), w / 2, h / 2 - 10);
      ctx.font = '600 16px "Avenir Next", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText('GET READY', w / 2, h / 2 + 28);
    }

    // wait mode prompt
    if (this.paused && this.pauseReason === 'wait') {
      const lane = this.notes[this.waitIdx]?.lane ?? 'kick';
      ctx.fillStyle = '#f87171';
      ctx.font = '700 22px "Avenir Next", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`HIT ${LANE_LABEL[lane].toUpperCase()} TO CONTINUE`, w / 2, h / 2 - 30);
    }
  }

  /**
   * Hit feedback at the lane target: the note pops, a ring bursts outward,
   * sparks fly, and the judgment (with EARLY/LATE when off) rises above the
   * lane. A miss tints the lane red.
   */
  private drawEffects(ctx: CanvasRenderingContext2D, now: number, laneW: number, hitY: number, h: number) {
    this.effects = this.effects.filter((e) => now - e.at < EFFECT_LIFE && now >= e.at - 0.05);
    // one judgment label per lane: a newer hit replaces the older text
    const newest: Partial<Record<Lane, number>> = {};
    for (const e of this.effects) newest[e.lane] = Math.max(newest[e.lane] ?? -Infinity, e.at);
    for (const e of this.effects) {
      const showText = newest[e.lane] === e.at;
      const age = Math.max(0, now - e.at);
      const k = age / EFFECT_LIFE; // 0 → 1
      const cx = LANES.indexOf(e.lane) * laneW + laneW / 2;
      const color = LANE_COLOR[e.lane];

      if (e.judge === 'miss') {
        const a = Math.max(0, 1 - age / 0.25);
        ctx.fillStyle = `rgba(248,113,113,${0.16 * a})`;
        ctx.fillRect(cx - laneW / 2, 0, laneW, h);
        if (showText) {
          ctx.globalAlpha = Math.max(0, 1 - k * 1.4);
          ctx.fillStyle = JUDGE_COLOR.miss;
          ctx.font = '800 15px "Avenir Next", system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('MISS', cx, hitY - 48 - age * 40);
          ctx.globalAlpha = 1;
        }
        continue;
      }

      // lane glow + target fill
      const flash = Math.max(0, 1 - age / 0.18);
      if (flash > 0) {
        const g = ctx.createLinearGradient(0, hitY - 220, 0, hitY);
        g.addColorStop(0, hexA(color, 0));
        g.addColorStop(1, hexA(color, 0.28 * flash));
        ctx.fillStyle = g;
        ctx.fillRect(cx - laneW / 2, hitY - 220, laneW, 220);
        ctx.beginPath();
        ctx.arc(cx, hitY, 34, 0, Math.PI * 2);
        ctx.fillStyle = hexA(color, 0.55 * flash);
        ctx.fill();
      }

      // the note pops on the line
      const pop = Math.max(0, 1 - age / 0.16);
      if (pop > 0) {
        const s = 1 + (1 - pop) * 0.45;
        const bw = laneW * 0.72 * s;
        ctx.globalAlpha = pop;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.roundRect(cx - bw / 2, hitY - 9 * s, bw, 18 * s, 7 * s);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // expanding rings (perfect gets a second, gold ring)
      const ease = 1 - (1 - Math.min(1, age / 0.32)) ** 3;
      const ringA = Math.max(0, 1 - age / 0.32);
      if (ringA > 0) {
        ctx.lineWidth = 4 * ringA + 1;
        ctx.strokeStyle = hexA(color, ringA);
        ctx.beginPath();
        ctx.arc(cx, hitY, 34 + ease * 34, 0, Math.PI * 2);
        ctx.stroke();
        if (e.judge === 'perfect') {
          ctx.strokeStyle = hexA(JUDGE_COLOR.perfect, ringA * 0.8);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, hitY, 34 + ease * 52, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.lineWidth = 1;
      }

      // sparks
      const sparks = e.judge === 'perfect' ? 12 : e.judge === 'great' ? 9 : 6;
      let r = e.seed * 9301 + 49297;
      const rand = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
      const sparkA = Math.max(0, 1 - age / 0.42);
      if (sparkA > 0) {
        ctx.fillStyle = hexA(color, sparkA);
        for (let i = 0; i < sparks; i++) {
          const ang = (i / sparks) * Math.PI * 2 + rand() * 0.5;
          const speed = 150 + rand() * 170;
          const d = 30 + speed * age;
          const size = 3.2 * sparkA + 0.6;
          ctx.beginPath();
          ctx.arc(cx + Math.cos(ang) * d, hitY + Math.sin(ang) * d * 0.8, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // judgment above the lane, with EARLY / LATE when it matters
      if (!showText) continue;
      const textA = age < 0.3 ? 1 : Math.max(0, 1 - (age - 0.3) / 0.25);
      const rise = age * 70;
      const scale = 1 + Math.max(0, 0.12 - age) * 2.5;
      ctx.globalAlpha = textA;
      ctx.textAlign = 'center';
      ctx.fillStyle = JUDGE_COLOR[e.judge];
      ctx.font = `800 ${Math.round(17 * scale)}px "Avenir Next", system-ui, sans-serif`;
      ctx.fillText(e.judge.toUpperCase(), cx, hitY - 50 - rise);
      if (e.judge !== 'perfect' && Math.abs(e.delta) > 0.02) {
        ctx.font = '700 11px "Avenir Next", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillText(`${e.delta < 0 ? 'EARLY' : 'LATE'} ${Math.round(Math.abs(e.delta) * 1000)}ms`, cx, hitY - 34 - rise);
      }
      ctx.globalAlpha = 1;
    }
  }
}

export { LANE_COLOR, starsForAccuracy };
