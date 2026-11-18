import { useCallback, useEffect, useRef, useState } from 'react';
import { GameEngine } from '../engine/game';
import type { GameMode, Hud, RunResult } from '../engine/game';
import type { Lesson } from '../engine/types';
import type { SongChart } from '../engine/transcribe';
import { sharedAudio } from '../engine/audio';
import { MidiManager } from '../engine/midi';
import Icon from './Icon';

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
    const mm = new MidiManager((lane, vel, at) => engine.hit(lane, vel, at));
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
  const combo = hud?.combo ?? 0;
  const done = hud && hud.notesTotal > 0 ? hud.notesDone / hud.notesTotal : 0;
  const midiOk = midiStatus.startsWith('MIDI:');
  const autoMs = Math.round(sharedAudio.latencySec() * 1000);

  // Esc opens and closes the settings panel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (menuOpen) resume();
      else openMenu();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen, openMenu, resume]);

  return (
    <div className="play">
      <header className="play-bar">
        <div className="play-title">
          <button type="button" className="btn btn-quiet btn-icon" aria-label="Exit" title="Exit" onClick={onQuit}>
            <Icon name="close" />
          </button>
          <div style={{ minWidth: 0 }}>
            <div className="name">{title}</div>
            <div className="sub">{midiOk ? midiStatus.replace('MIDI: ', 'Kit connected · ') : 'Keyboard: D F J K L ;'}</div>
          </div>
        </div>

        <div className="play-center">
          <div className="seg" role="group" aria-label="Mode">
            <button type="button" aria-pressed={mode === 'performance'} onClick={() => changeMode('performance')}>
              Perform
            </button>
            <button type="button" aria-pressed={mode === 'practice'} onClick={() => changeMode('practice')}>
              Practice
            </button>
          </div>
          <span className="tempo">
            <b>{hud?.bpm ?? baseBpm}</b> bpm{bpmMul !== 1 ? ` · ${Math.round(bpmMul * 100)}%` : ''}
          </span>
        </div>

        <div className="play-stats">
          <div className="stat">
            <span className="k">Accuracy</span>
            <span className="v">{acc}%</span>
          </div>
          <div className="stat">
            <span className="k">Streak</span>
            <span className={`v${combo >= 10 ? ' hot' : ''}`}>{combo}</span>
          </div>
          <div className="stat">
            <span className="k">Score</span>
            <span className="v">{(hud?.score ?? 0).toLocaleString()}</span>
          </div>
          <button type="button" className="btn btn-icon" aria-label="Settings" title="Settings (Esc)" onClick={menuOpen ? resume : openMenu}>
            <Icon name={menuOpen ? 'close' : 'sliders'} />
          </button>
        </div>
      </header>

      <div className="play-progress" aria-hidden="true">
        <span style={{ width: `${done * 100}%` }} />
      </div>

      <div className="stage">
        <canvas
          ref={canvasRef}
          onPointerDown={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const lane = engine.laneAt(e.clientY - r.top);
            if (lane) engine.hit(lane, 1, e.timeStamp);
          }}
        />

        {menuOpen && (
          <>
            <div className="panel-scrim" onClick={resume} />
            <aside className="panel" aria-label="Settings">
              <div className="panel-head">
                <h2>Paused</h2>
                <span className="faint" style={{ fontSize: 12 }}>
                  Esc to resume
                </span>
              </div>
              <div className="panel-body">
                {levels && levels.length > 1 && onLevel && (
                  <div className="panel-group">
                    <label className="field">
                      Level
                      <select className="select" value={level} onChange={(e) => onLevel(Number(e.target.value), mode)}>
                        {levels.map((l) => (
                          <option key={l.level} value={l.level}>
                            {l.level}. {l.name} ({l.notes} notes)
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}

                {mode === 'practice' ? (
                  <div className="panel-group">
                    <label className="field">
                      Section
                      <select
                        className="select"
                        value={sectionIdx}
                        onChange={(e) => {
                          const i = Number(e.target.value);
                          setSectionIdx(i);
                          engine.setSection(i);
                          restart(mode, i, bpmMul, speed, waitMode);
                        }}
                      >
                        <option value={-1}>Whole {isSong ? 'song' : 'lesson'}</option>
                        {sections.map((sec, i) => (
                          <option key={i} value={i}>
                            {isSong
                              ? `${sec.name} (${fmtSec(sec.start)}–${fmtSec(sec.end)})`
                              : `${sec.name} (bars ${Math.floor(sec.start / 4) + 1}–${Math.ceil(sec.end / 4)})`}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>
                        Tempo{' '}
                        <span className="field-hint mono">
                          {Math.round(baseBpm * bpmMul)} bpm · {Math.round(bpmMul * 100)}%
                        </span>
                      </span>
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
                      {isSong && <span className="range-ends">Slowing a song lowers its pitch</span>}
                    </label>
                    <label className="check">
                      Wait for me on a miss
                      <input
                        type="checkbox"
                        checked={waitMode}
                        onChange={(e) => {
                          setWaitMode(e.target.checked);
                          engine.setWaitMode(e.target.checked);
                        }}
                      />
                    </label>
                  </div>
                ) : (
                  <p className="faint" style={{ fontSize: 12.5 }}>
                    Perform plays the full {isSong ? 'song' : 'lesson'} at full tempo and earns stars. Switch to Practice to loop a
                    section or slow it down.
                  </p>
                )}

                <div className="panel-group">
                  <label className="field">
                    <span>
                      Scroll speed <span className="field-hint mono">{Math.round(speed * 100)}%</span>
                    </span>
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
                  <label className="check">
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
                </div>

                <div className="panel-group">
                  <label className="field">
                    <span>
                      Audio delay{' '}
                      <span className="field-hint mono">{calMs === null ? `auto · ${autoMs} ms` : `${calMs} ms`}</span>
                    </span>
                    <input
                      type="range"
                      min={-100}
                      max={500}
                      step={5}
                      value={calMs ?? autoMs}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setCalMs(v);
                        engine.setCalibration(v);
                        localStorage.setItem('drumlab:cal-ms', String(v));
                      }}
                    />
                    <span className="field-hint">
                      How long your speakers or headphones take to play a sound. Hits judged late while you play on the beat: raise it.
                    </span>
                  </label>
                  {calMs !== null && (
                    <button
                      type="button"
                      className="btn btn-quiet"
                      style={{ alignSelf: 'flex-start' }}
                      onClick={() => {
                        setCalMs(null);
                        engine.setCalibration(null);
                        localStorage.removeItem('drumlab:cal-ms');
                      }}
                    >
                      Use the device value ({autoMs} ms)
                    </button>
                  )}
                </div>
              </div>
              <div className="panel-foot">
                <button type="button" className="btn btn-primary" onClick={resume}>
                  Resume
                </button>
                <button type="button" className="btn" onClick={() => restart(mode, sectionIdx, bpmMul, speed, waitMode)}>
                  Restart
                </button>
              </div>
            </aside>
          </>
        )}
      </div>
    </div>
  );
}
