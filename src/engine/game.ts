import { sharedAudio } from './audio';
import type { Lane, Lesson, Note, Section } from './types';
import { LANES, LANE_LABEL, ROW_OF, ROW_ORDER, plays, rowsFor } from './types';
import { LANE_KEY } from './midi';
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
  kick: '#f0703f',
  snare: '#e9b949',
  hh: '#56bee3',
  hhOpen: '#a2dbf0', // the hi-hat's own blue, lighter: same instrument, opened
  tomLo: '#a08ceb',
  tomHi: '#e77bb0',
  crash: '#4cc08e',
};

/**
 * One note. Most are solid; an open hi-hat is hollow with an "o" in it, the
 * way drum notation marks an open hat, so it stands apart from the closed
 * hats in the same row. `missed` draws only the outline (in `color`).
 */
function drawNote(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  lane: Lane,
  color: string,
  missed = false,
) {
  if (lane !== 'hhOpen') {
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, Math.min(4, w / 3));
    if (missed) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fill();
    }
    return;
  }
  const lw = w >= 14 ? 2.5 : 1.5;
  ctx.beginPath();
  ctx.roundRect(x - w / 2 + lw / 2, y - h / 2 + lw / 2, w - lw, h - lw, Math.min(3.5, w / 3));
  if (!missed) {
    ctx.fillStyle = hexA(color, 0.14);
    ctx.fill();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, Math.max(2, Math.min(4.5, h * 0.2, w / 2 - lw - 1.5)), 0, Math.PI * 2);
  ctx.lineWidth = lw >= 2.5 ? 2 : 1.5;
  ctx.stroke();
}

const INK = {
  header: '#141619',
  line: '#24272c',
  line2: '#30343a',
  text: '#edeef0',
  text2: '#a6abb3',
  text3: '#6c717a',
  accent: '#f06a37',
  bad: '#e5534b',
};

const FONT = "'Geist Variable', 'Helvetica Neue', Arial, sans-serif";
const MONO = "'Geist Mono Variable', ui-monospace, Menlo, monospace";

/** row geometry of the last frame (also used to map clicks to lanes) */
interface Geo {
  headerW: number;
  hitX: number;
  top: number;
  rowH: number;
  rows: Lane[];
  w: number;
  h: number;
}

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
  perfect: '#f2cd61',
  great: '#56bee3',
  good: '#4cc08e',
  miss: '#e5534b',
};
const JUDGE_TEXT: Record<Judgement, string> = { perfect: 'Perfect', great: 'Great', good: 'Good', miss: 'Miss' };
const EFFECT_LIFE = 0.55;

const PX_PER_BEAT = 200;
const PX_PER_SEC = 260;

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
  /** lanes shown, top to bottom (only lanes the lesson or song uses) */
  private rows: Lane[] = ROW_ORDER;
  /** the chart has open-hat notes: the hi-hat row's header shows both of its notes and keys */
  private openHats = false;
  private geo: Geo | null = null;
  private effectSeed = 1;
  /** last combo milestone shown (every 10) */
  private comboShown = 0;
  /** last hit time per chart row */
  private flashTimes: Partial<Record<Lane, number>> = {};

  onHud: (h: Hud) => void = () => {};
  onResult: (r: RunResult) => void = () => {};
  /** a pad was hit (any lane, judged or not); vel 0..1 */
  onFlash: (lane: Lane, vel: number) => void = () => {};
  /** the key that plays each lane (computer or piano), shown under each row label */
  keyHints: Record<Lane, string> = { ...LANE_KEY };
  /** a note went by unplayed */
  onMiss: (lane: Lane) => void = () => {};
  /** once per frame, after drawing */
  onFrame: () => void = () => {};

  private emptyLaneCount(): Record<Lane, number> {
    return Object.fromEntries(LANES.map((l) => [l, 0])) as Record<Lane, number>;
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
    this.rows = rowsFor(lesson.notes);
    this.openHats = lesson.notes.some((nn) => nn.lane === 'hhOpen');
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
    this.rows = rowsFor(chart.notes);
    this.openHats = chart.notes.some((nn) => nn.lane === 'hhOpen');
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
    this.flashTimes[ROW_OF[lane]] = now;
    this.onFlash(lane, vel);

    // the count-in hands over to play on the next frame; a hit on (or just
    // before) the first beat must still count
    if (this.phase !== 'playing' && this.phase !== 'countin') return;
    if (this.paused) {
      const waited = this.notes[this.waitIdx];
      if (this.pauseReason === 'wait' && waited && plays(lane, waited.lane)) {
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
      if (this.judged[i] !== null || !plays(lane, this.notes[i].lane)) continue;
      const d = Math.abs(this.noteTime(i) - now);
      if (d <= GOOD_MS && d < bestAbs) {
        best = i;
        bestAbs = d;
      }
    }
    if (best === -1) return; // ghost hit — sound played, no judge

    // the note's own drum gets the credit (an open hat can play a hi-hat note)
    const noteLane = this.notes[best].lane;
    const delta = now - this.noteTime(best);
    const j = judgeDelta(delta);
    this.judged[best] = j;
    this.deltas[best] = delta;
    this.hits++;
    this.laneHit[noteLane]++;
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
    this.effects.push({ lane: noteLane, at: shownAt, judge: j, delta, seed: this.effectSeed++ });
    if (this.combo >= 10 && this.combo % 10 === 0 && this.combo !== this.comboShown) {
      this.comboShown = this.combo;
      this.floats.push({ text: `${this.combo} in a row`, color: INK.accent, x: 0.5, at: shownAt });
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
    this.onMiss(this.notes[i].lane);
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
    this.onFrame();
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

  /**
   * How close each drum's next note is: 0 = half a beat or more away, 1 = due now.
   * Drives the drum kit's "this one next" glow. Fills and returns `out`.
   */
  cueLevels(out: Record<Lane, number>): Record<Lane, number> {
    for (const l of LANES) out[l] = 0;
    if ((!this.lesson && !this.chart) || this.phase === 'idle' || this.phase === 'done') return out;
    if (this.paused && this.pauseReason === 'wait' && this.waitIdx >= 0) {
      // waiting for one drum: that one stays lit until it is hit
      out[this.notes[this.waitIdx].lane] = 1;
      return out;
    }
    const now = this.now();
    // half a beat of lead: each 8th note gets its own build-up instead of a constant glow
    const horizon = Math.min(0.6, Math.max(0.3, this.clickSpb / 2));
    // notes are sorted: skip straight to the first one still inside the hit window
    let lo = 0;
    let hi = this.notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.noteTime(mid) < now - GOOD_MS) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < this.notes.length; i++) {
      const dt = this.noteTime(i) - now;
      if (dt > horizon) break;
      if (this.judged[i] !== null) continue;
      const c = 1 - Math.max(0, dt) / horizon;
      const lane = this.notes[i].lane;
      if (c > out[lane]) out[lane] = c;
    }
    return out;
  }

  /** row under a point on the canvas (CSS px), for clicking/tapping a row; the hi-hat row plays the closed hat */
  laneAt(y: number): Lane | null {
    const g = this.geo;
    if (!g || y < g.top) return null;
    const i = Math.floor((y - g.top) / g.rowH);
    return g.rows[i] ?? null;
  }

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

    const rows = this.rows;
    const headerW = Math.round(Math.min(136, Math.max(96, w * 0.11)));
    const hitX = headerW + Math.round(Math.max(44, w * 0.055));
    const top = 26;
    const bottom = 10;
    const rowH = (h - top - bottom) / rows.length;
    const geo: Geo = { headerW, hitX, top, rowH, rows, w, h };
    this.geo = geo;
    const rowY = (i: number) => top + rowH * (i + 0.5);
    const noteH = Math.min(46, Math.max(14, rowH * 0.46));
    const noteW = 18;
    const pxPerSec = this.songMode
      ? PX_PER_SEC * this.speed
      : ((PX_PER_BEAT * (this.lesson!.bpm * this.bpmMul)) / 60) * this.speed;
    const xAt = (t: number) => hitX + (t - now) * pxPerSec;

    // rows
    for (let i = 0; i < rows.length; i++) {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.018)' : 'rgba(255,255,255,0.008)';
      ctx.fillRect(headerW, top + i * rowH, w - headerW, rowH);
    }
    ctx.fillStyle = INK.line;
    for (let i = 0; i <= rows.length; i++) ctx.fillRect(headerW, Math.round(top + i * rowH), w - headerW, 1);

    // beat grid with bar numbers (tracked beats for songs, the lesson's own beats)
    ctx.font = `500 11px ${MONO}`;
    ctx.textAlign = 'left';
    const gridLine = (x: number, bar: number | null) => {
      if (x < headerW || x > w) return;
      ctx.fillStyle = bar !== null ? 'rgba(255,255,255,0.11)' : 'rgba(255,255,255,0.04)';
      ctx.fillRect(Math.round(x), top, 1, h - top - bottom);
      if (bar !== null && bar >= 1) {
        ctx.fillStyle = INK.text3;
        ctx.fillText(String(bar), Math.round(x) + 4, 17);
      }
    };
    if (this.beatSync) {
      const beats = this.chart!.beats!;
      const down = this.chart!.downbeat ?? 0;
      for (let i = 0; i < beats.length; i++) {
        const x = xAt(this.anchor.time + (beats[i] - this.anchor.beat) * this.spb);
        if (x < headerW) continue;
        if (x > w) break;
        const k = i - down;
        gridLine(x, ((k % 4) + 4) % 4 === 0 ? k / 4 + 1 : null);
      }
    } else if (!this.songMode && this.lesson) {
      const b0 = Math.ceil(this.anchor.beat + (now - (hitX - headerW) / pxPerSec - this.anchor.time) / this.spb);
      const b1 = Math.floor(this.anchor.beat + (now + (w - hitX) / pxPerSec - this.anchor.time) / this.spb);
      for (let b = Math.max(b0, -this.lesson.countInBeats); b <= Math.min(b1, this.lesson.totalBeats); b++) {
        gridLine(xAt(this.anchor.time + (b - this.anchor.beat) * this.spb), b >= 0 && b % 4 === 0 ? b / 4 + 1 : null);
      }
    }

    // hit line + a target per row in the note's own shape
    ctx.fillStyle = 'rgba(237,238,240,0.85)';
    ctx.fillRect(hitX - 1, top, 2, h - top - bottom);
    for (let i = 0; i < rows.length; i++) {
      const lane = rows[i];
      const flash = this.flashTimes[lane];
      const hot = flash !== undefined && now - flash >= 0 && now - flash < 0.12;
      ctx.beginPath();
      ctx.roundRect(hitX - noteW / 2 - 3, rowY(i) - noteH / 2 - 3, noteW + 6, noteH + 6, 5);
      ctx.strokeStyle = hexA(LANE_COLOR[lane], hot ? 0.95 : 0.4);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (hot) {
        ctx.fillStyle = hexA(LANE_COLOR[lane], 0.3);
        ctx.fill();
      }
    }

    // notes: solid (an open hat hollow), no glow; missed ones slide on past the line and fade
    for (let i = 0; i < this.notes.length; i++) {
      const note = this.notes[i];
      const row = rows.indexOf(ROW_OF[note.lane]);
      if (row < 0) continue;
      const t = this.noteTime(i);
      const x = xAt(t);
      if (x > w + 20) break;
      if (x < headerW - 20) continue;
      const j = this.judged[i];
      if (j !== null && j !== 'miss') continue; // hit notes pop (drawEffects)
      const y = rowY(row);
      if (j === 'miss') {
        const fade = 1 - (now - t) / 0.6;
        if (fade <= 0) continue;
        drawNote(ctx, x, y, noteW, noteH, note.lane, hexA(INK.bad, 0.8 * Math.min(1, fade)), true);
        continue;
      }
      drawNote(ctx, x, y, noteW, noteH, note.lane, LANE_COLOR[note.lane]);
    }

    this.drawEffects(ctx, now, geo);

    // row headers sit above everything: they are the lane labels and the pads
    ctx.fillStyle = INK.header;
    ctx.fillRect(0, 0, headerW, h);
    ctx.fillStyle = INK.line;
    ctx.fillRect(headerW - 1, 0, 1, h);
    for (let i = 0; i < rows.length; i++) {
      const lane = rows[i];
      const y = rowY(i);
      const flash = this.flashTimes[lane];
      const hot = flash !== undefined && now - flash >= 0 && now - flash < 0.15;
      if (hot) {
        ctx.fillStyle = hexA(LANE_COLOR[lane], 0.14);
        ctx.fillRect(0, top + i * rowH + 1, headerW - 1, rowH - 1);
      }
      ctx.fillStyle = LANE_COLOR[lane];
      ctx.fillRect(0, top + i * rowH + 6, 3, rowH - 12);
      ctx.textAlign = 'left';
      ctx.fillStyle = INK.text;
      ctx.font = `550 13px ${FONT}`;
      ctx.fillText(LANE_LABEL[lane], 16, y + (rowH > 44 ? -2 : 4));
      if (rowH > 44) {
        ctx.fillStyle = INK.text3;
        ctx.font = `500 11px ${MONO}`;
        if (lane === 'hh' && this.openHats) {
          // one row, two hi-hats: the closed note and its key, then the open note and its key
          let x = 16;
          for (const l of ['hh', 'hhOpen'] as const) {
            drawNote(ctx, x + 5, y + 10, 10, 14, l, LANE_COLOR[l]);
            x += 14;
            ctx.fillStyle = INK.text3;
            ctx.fillText(this.keyHints[l], x, y + 14);
            x += ctx.measureText(this.keyHints[l]).width + 10;
          }
        } else {
          ctx.fillText(this.keyHints[lane], 16, y + 14);
        }
      }
      ctx.fillStyle = INK.line;
      ctx.fillRect(0, Math.round(top + (i + 1) * rowH), headerW, 1);
    }

    const midX = hitX + (w - hitX) / 2;
    // combo milestones
    this.floats = this.floats.filter((f) => now - f.at < 0.9);
    for (const f of this.floats) {
      const age = now - f.at;
      ctx.globalAlpha = age < 0.4 ? 1 : Math.max(0, 1 - (age - 0.4) / 0.5);
      ctx.fillStyle = f.color;
      ctx.font = `650 17px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(f.text, midX, top + 30 - age * 14);
      ctx.globalAlpha = 1;
    }

    // count-in (beat-synced songs count in over the intro, into bar 1)
    const syncK = this.syncCount();
    if (this.phase === 'countin' || syncK > 0) {
      const countInBeats = this.songMode ? (this.chart?.countInBeats ?? 4) : (this.lesson?.countInBeats ?? 4);
      const k = syncK > 0 ? syncK : Math.min(countInBeats, Math.max(1, Math.floor(this.musicBeatNow()) + countInBeats + 1));
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(13,14,16,0.72)';
      ctx.beginPath();
      ctx.roundRect(midX - 70, h / 2 - 62, 140, 112, 12);
      ctx.fill();
      ctx.fillStyle = INK.text;
      ctx.font = `500 64px ${MONO}`;
      ctx.fillText(String(k), midX, h / 2 + 12);
      ctx.font = `500 13px ${FONT}`;
      ctx.fillStyle = INK.text2;
      ctx.fillText(`Count-in ${k} of ${countInBeats}`, midX, h / 2 + 36);
    }

    // wait mode prompt
    if (this.paused && this.pauseReason === 'wait') {
      const lane = this.notes[this.waitIdx]?.lane ?? 'kick';
      ctx.fillStyle = INK.text;
      ctx.font = `600 16px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(`Hit ${LANE_LABEL[lane].toLowerCase()} to continue`, midX, top + 32);
    }
  }

  /**
   * Hit feedback at the row's target: the note pops, a ring bursts, sparks
   * fly, the row lights up behind the line, and the judgment (with how early
   * or late) sits just after the line. A miss tints the row red.
   */
  private drawEffects(ctx: CanvasRenderingContext2D, now: number, g: Geo) {
    this.effects = this.effects.filter((e) => now - e.at < EFFECT_LIFE && now >= e.at - 0.05);
    const newest: Partial<Record<Lane, number>> = {};
    for (const e of this.effects) newest[ROW_OF[e.lane]] = Math.max(newest[ROW_OF[e.lane]] ?? -Infinity, e.at);
    const noteH = Math.min(46, Math.max(14, g.rowH * 0.46));
    for (const e of this.effects) {
      const row = g.rows.indexOf(ROW_OF[e.lane]);
      if (row < 0) continue;
      const showText = newest[ROW_OF[e.lane]] === e.at;
      const age = Math.max(0, now - e.at);
      const k = age / EFFECT_LIFE;
      const cy = g.top + g.rowH * (row + 0.5);
      const rowTop = g.top + g.rowH * row;
      const color = LANE_COLOR[e.lane];
      const textY = rowTop + Math.min(18, g.rowH * 0.22) + 2;

      if (e.judge === 'miss') {
        if (!showText) continue;
        const a = Math.max(0, 1 - age / 0.3);
        ctx.fillStyle = `rgba(229,83,75,${0.07 * a})`;
        ctx.fillRect(g.headerW, rowTop + 1, g.w - g.headerW, g.rowH - 1);
        {
          ctx.globalAlpha = Math.max(0, 1 - k * 1.3);
          ctx.fillStyle = JUDGE_COLOR.miss;
          ctx.font = `600 12px ${FONT}`;
          ctx.textAlign = 'left';
          ctx.fillText('Miss', g.hitX + 14, textY);
          ctx.globalAlpha = 1;
        }
        continue;
      }

      // the row lights up just past the line
      const flash = Math.max(0, 1 - age / 0.22);
      if (flash > 0) {
        const glow = ctx.createLinearGradient(g.hitX, 0, g.hitX + 220, 0);
        glow.addColorStop(0, hexA(color, 0.22 * flash));
        glow.addColorStop(1, hexA(color, 0));
        ctx.fillStyle = glow;
        ctx.fillRect(g.hitX, rowTop + 1, 220, g.rowH - 1);
      }

      // the note pops on the line
      const pop = Math.max(0, 1 - age / 0.16);
      if (pop > 0) {
        const s = 1 + (1 - pop) * 0.5;
        ctx.globalAlpha = pop;
        drawNote(ctx, g.hitX, cy, 18 * s, noteH * s, e.lane, '#ffffff');
        ctx.globalAlpha = 1;
      }

      // ring (gold second ring on a perfect)
      const ease = 1 - (1 - Math.min(1, age / 0.3)) ** 3;
      const ringA = Math.max(0, 1 - age / 0.3);
      const r0 = noteH / 2 + 4;
      if (ringA > 0) {
        ctx.lineWidth = 3 * ringA + 1;
        ctx.strokeStyle = hexA(color, ringA);
        ctx.beginPath();
        ctx.arc(g.hitX, cy, r0 + ease * 26, 0, Math.PI * 2);
        ctx.stroke();
        if (e.judge === 'perfect') {
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = hexA(JUDGE_COLOR.perfect, ringA * 0.8);
          ctx.beginPath();
          ctx.arc(g.hitX, cy, r0 + ease * 40, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.lineWidth = 1;
      }

      // sparks
      const sparks = e.judge === 'perfect' ? 10 : e.judge === 'great' ? 7 : 5;
      let r = e.seed * 9301 + 49297;
      const rand = () => (r = (r * 9301 + 49297) % 233280) / 233280;
      const sparkA = Math.max(0, 1 - age / 0.4);
      if (sparkA > 0) {
        ctx.fillStyle = hexA(color, sparkA);
        for (let i = 0; i < sparks; i++) {
          const ang = (i / sparks) * Math.PI * 2 + rand() * 0.5;
          const d = r0 + (110 + rand() * 140) * age;
          ctx.beginPath();
          ctx.arc(g.hitX + Math.cos(ang) * d, cy + Math.sin(ang) * d * 0.75, 2.6 * sparkA + 0.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // judgment just after the line, in the top of the row
      if (!showText) continue;
      ctx.globalAlpha = age < 0.3 ? 1 : Math.max(0, 1 - (age - 0.3) / 0.25);
      ctx.textAlign = 'left';
      ctx.fillStyle = JUDGE_COLOR[e.judge];
      ctx.font = `650 ${age < 0.08 ? 13 : 12}px ${FONT}`;
      const label = JUDGE_TEXT[e.judge];
      ctx.fillText(label, g.hitX + 14, textY);
      if (e.judge !== 'perfect' && Math.abs(e.delta) > 0.02) {
        const lw = ctx.measureText(label).width;
        ctx.fillStyle = INK.text2;
        ctx.font = `500 11px ${MONO}`;
        ctx.fillText(`${Math.round(Math.abs(e.delta) * 1000)} ms ${e.delta < 0 ? 'early' : 'late'}`, g.hitX + 20 + lw, textY);
      }
      ctx.globalAlpha = 1;
    }
  }
}

export { LANE_COLOR, starsForAccuracy };
