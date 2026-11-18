import { useCallback, useEffect, useRef, useState } from 'react';
import { GameEngine } from '../engine/game';
import type { GameMode, Hud, RunResult } from '../engine/game';
import type { Lane, Lesson } from '../engine/types';
import type { SongChart } from '../engine/transcribe';
import { sharedAudio } from '../engine/audio';
import { MidiManager } from '../engine/midi';
import Pads from './Pads';

interface Props {
  lesson: Lesson | null;
  song: { chart: SongChart; buffer: AudioBuffer; title: string } | null;
  /** start in practice mode (song cards' Practice button) */
  initialMode?: GameMode;
  /** a song's playable levels and the one being played */
  levels?: { level: number; name: string; notes: number }[];
  level?: number;
  onLevel?: (level: number, mode: GameMode) => void;
  onFinish: (r: RunResult) => void;
  onQuit: () => void;
}

const MIDI_LABEL: Record<string, string> = {
  'no-midi': 'MIDI unavailable — using keys',
  'midi:none': 'MIDI ready — no devices found',
  'midi-denied': 'MIDI blocked — using keys',
};

const fmtSec = (s: number) => {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
};

export default function PlayView({ lesson, song, initialMode, levels, level, onLevel, onFinish, onQuit }: Props) {
  const engineRef = useRef<GameEngine | null>(null);
  if (!engineRef.current) engineRef.current = new GameEngine();
  const engine = engineRef.current;
  // dev builds: let automated tests read the clock and playhead
  if (import.meta.env.DEV) {
    (window as unknown as { __engine?: GameEngine }).__engine = engine;
  }

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [mode, setMode] = useState<GameMode>(initialMode ?? 'performance');
  const [sectionIdx, setSectionIdx] = useState(-1);
  const [bpmMul, setBpmMul] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [waitMode, setWaitMode] = useState(false);
  // songs carry their own beat; the click is opt-in there
  const [metronome, setMetronome] = useState(() => !(!lesson && !!song));
  const [midiStatus, setMidiStatus] = useState('checking MIDI…');
  const [flash, setFlash] = useState({ key: 0, lane: null as Lane | null });
  const [menuOpen, setMenuOpen] = useState(false);
  const [calMs, setCalMs] = useState<number | null>(() => {
    const v = localStorage.getItem('drumlab:cal-ms');
    return v !== null ? Number(v) : null;
  });

  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  const title = lesson?.title ?? song?.title ?? 'Lesson';
  const baseBpm = lesson?.bpm ?? song?.chart.bpm ?? 100;
  const sections = lesson?.sections ?? song?.chart.sections ?? [];
  const isSong = !lesson && !!song;

  // wire engine callbacks once
  useEffect(() => {
    engine.onHud = (h) => setHud(h);
    engine.onResult = (r) => onFinishRef.current(r);
    engine.onFlash = (lane) => setFlash((f) => ({ key: f.key + 1, lane }));
    if (canvasRef.current) engine.attach(canvasRef.current);
    const savedCal = localStorage.getItem('drumlab:cal-ms');
    engine.setCalibration(savedCal !== null ? Number(savedCal) : null);
    const startMode = initialMode ?? 'performance';
    if (song) engine.loadSong(song.chart, song.buffer, startMode, { sectionIndex: -1, bpmMul: 1, waitMode: false, speed: 1 });
    else if (lesson) engine.load(lesson, startMode, { sectionIndex: -1, bpmMul: 1, waitMode: false, speed: 1 });
    engine.setMetronome(metronome);
    engine.start();
    return () => engine.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // MIDI + keyboard
  useEffect(() => {
    const mm = new MidiManager((lane, vel) => engine.hit(lane, vel));
    mm.attachKeyboard();
    let cancelled = false;
    void mm.init().then((s) => {
      if (!cancelled) setMidiStatus(MIDI_LABEL[s] ?? `MIDI: ${s.split(':')[1]} device(s)`);
    });
    return () => {
      cancelled = true;
      mm.detach();
    };
  }, [engine]);

  const restart = useCallback(
    (m: GameMode, secIdx: number, bm: number, sp: number, wm: boolean) => {
      const opts = { sectionIndex: secIdx, bpmMul: bm, waitMode: wm, speed: sp };
      if (song) engine.loadSong(song.chart, song.buffer, m, opts);
      else if (lesson) engine.load(lesson, m, opts);
      engine.start();
      setMenuOpen(false);
    },
    [engine, lesson, song],
  );

  const openMenu = useCallback(() => {
    engine.pause();
    setMenuOpen(true);
  }, [engine]);

  const resume = useCallback(() => {
    engine.resume();
    setMenuOpen(false);
  }, [engine]);

  const changeMode = (m: GameMode) => {
    setMode(m);
    setSectionIdx(-1);
    engine.setSection(-1);
    restart(m, -1, bpmMul, speed, waitMode);
  };

  const acc = hud ? Math.round(hud.accuracy * 100) : 0;
  const paused = hud?.paused ?? false;
  const overlay = menuOpen || paused;

  return (
    <div className="play-view">
      <div className="hud">
        <span className="pill" style={{ color: 'var(--text)', fontWeight: 800 }}>
          {title}
        </span>
        <div className="stat">
          <span className="lbl">Accuracy</span>
          <span className="val">{acc}%</span>
        </div>
        <div className="stat">
          <span className="lbl">Combo</span>
          <span className={`val combo-val${(hud?.combo ?? 0) > 0 ? ' pop' : ''}`} key={hud?.combo}>
            {hud?.combo ?? 0}
          </span>
        </div>
        <div className="stat">
          <span className="lbl">Score</span>
          <span className="val">{hud?.score ?? 0}</span>
        </div>
        <div className="stat">
          <span className="lbl">Tempo</span>
          <span className="val">{hud?.bpm ?? baseBpm}</span>
        </div>
        <div className="stat">
          <span className="lbl">Mode</span>
          <span className="val" style={{ fontSize: 15 }}>
            {mode === 'performance' ? '⭐ Performance' : '🎯 Practice'}
          </span>
        </div>
        <span className="spacer" />
        <span className={`midi-chip${midiStatus.startsWith('MIDI:') ? ' ok' : ''}`}>{midiStatus}</span>
        <button type="button" className="btn" onClick={openMenu}>
          {paused && !menuOpen ? '▸ Resume' : '☰ Menu'}
        </button>
        <div className="progress-track">
          <div
            className="progress-fill"
            style={{ width: `${hud && hud.notesTotal > 0 ? (hud.notesDone / hud.notesTotal) * 100 : 0}%` }}
          />
        </div>
      </div>

      <div className="canvas-wrap">
        <canvas ref={canvasRef} />
        {overlay && (
          <div className="overlay">
            <div className="panel card">
              <h3>{menuOpen ? 'Menu' : 'Paused'}</h3>

              {levels && levels.length > 1 && onLevel && (
                <label className="ctl-row">
                  Level
                  <select
                    className="ctl"
                    value={level}
                    onChange={(e) => onLevel(Number(e.target.value), mode)}
                  >
                    {levels.map((l) => (
                      <option key={l.level} value={l.level}>
                        {l.level}. {l.name} ({l.notes} notes)
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div className="mode-switch">
                <button
                  type="button"
                  className={`btn${mode === 'performance' ? ' active' : ''}`}
                  onClick={() => changeMode('performance')}
                >
                  Performance
                </button>
                <button
                  type="button"
                  className={`btn${mode === 'practice' ? ' active' : ''}`}
                  onClick={() => changeMode('practice')}
                >
                  Practice
                </button>
              </div>

              {mode === 'practice' && (
                <>
                  <label className="ctl-row">
                    Section
                    <select
                      className="ctl"
                      value={sectionIdx}
                      onChange={(e) => {
                        const i = Number(e.target.value);
                        setSectionIdx(i);
                        engine.setSection(i);
                        restart(mode, i, bpmMul, speed, waitMode);
                      }}
                    >
                      <option value={-1}>Whole song</option>
                      {sections.map((s, i) => (
                        <option key={i} value={i}>
                          {isSong
                            ? `${s.name} (${fmtSec(s.start)}–${fmtSec(s.end)})`
                            : `${s.name} (bars ${Math.floor(s.start / 4) + 1}–${Math.ceil(s.end / 4)})`}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="ctl-row">
                    Tempo — {Math.round(baseBpm * bpmMul)} BPM ({Math.round(bpmMul * 100)}%)
                    {isSong && (
                      <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                        pitch shifts when slowed
                      </span>
                    )}
                    <input
                      type="range"
                      min={50}
                      max={120}
                      step={5}
                      value={Math.round(bpmMul * 100)}
                      onChange={(e) => {
                        const bm = Number(e.target.value) / 100;
                        setBpmMul(bm);
                        engine.setBpmMul(bm);
                      }}
                    />
                    <span className="vals">
                      <span>{Math.round(baseBpm * 0.5)}</span>
                      <span>{baseBpm}</span>
                      <span>{Math.round(baseBpm * 1.2)}</span>
                    </span>
                  </label>
                  <label className="toggle">
                    Wait mode — freeze on a miss until you hit it
                    <input
                      type="checkbox"
                      checked={waitMode}
                      onChange={(e) => {
                        setWaitMode(e.target.checked);
                        engine.setWaitMode(e.target.checked);
                      }}
                    />
                  </label>
                </>
              )}

              <label className="ctl-row">
                Note speed — {Math.round(speed * 100)}%
                <input
                  type="range"
                  min={60}
                  max={160}
                  step={10}
                  value={Math.round(speed * 100)}
                  onChange={(e) => {
                    const sp = Number(e.target.value) / 100;
                    setSpeed(sp);
                    engine.setSpeed(sp);
                  }}
                />
              </label>
              <label className="toggle">
                Metronome
                <input
                  type="checkbox"
                  checked={metronome}
                  onChange={(e) => {
                    setMetronome(e.target.checked);
                    engine.setMetronome(e.target.checked);
                  }}
                />
              </label>

              {isSong && (
                <label className="ctl-row">
                  Audio sync —{' '}
                  {calMs === null ? `auto (${Math.round(sharedAudio.latencySec() * 1000)}ms)` : `${calMs > 0 ? '+' : ''}${calMs}ms`}
                  <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                    Music sounds behind the notes? Raise. Ahead of them? Lower. Auto uses the device's reported output latency.
                  </span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="range"
                      min={-250}
                      max={350}
                      step={10}
                      value={calMs ?? Math.round(sharedAudio.latencySec() * 1000)}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setCalMs(v);
                        engine.setCalibration(v);
                        localStorage.setItem('drumlab:cal-ms', String(v));
                      }}
                    />
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setCalMs(null);
                        engine.setCalibration(null);
                        localStorage.removeItem('drumlab:cal-ms');
                      }}
                    >
                      Auto
                    </button>
                  </div>
                </label>
              )}

              <button type="button" className="btn primary big" onClick={resume}>
                Resume
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => restart(mode, sectionIdx, bpmMul, speed, waitMode)}
              >
                ↻ Restart
              </button>
              <button type="button" className="btn ghost" onClick={onQuit}>
                ✕ Quit
              </button>
            </div>
          </div>
        )}
      </div>

      <Pads onHit={(lane) => engine.hit(lane, 1)} flashKey={flash.key} flashLane={flash.lane} />
    </div>
  );
}
