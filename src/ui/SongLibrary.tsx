import { useCallback, useEffect, useRef, useState } from 'react';
import { analyzeInWorker } from '../engine/chart/client';
import type { ChartAnalysis } from '../engine/chart/pipeline';
import type { GameMode } from '../engine/game';
import { deleteSong, getSong, listSongs, putSong } from '../engine/songstore';
import type { SongMeta } from '../engine/songstore';
import {
  DEFAULT_SETTINGS,
  decodeAudioBytes,
  decodeAudioFile,
  levelId,
  monoSamples,
  normalizeSettings,
  pickLevel,
  songLevels,
} from '../engine/transcribe';
import type { SongChart, SongLevel, SongSettings } from '../engine/transcribe';
import { nextSongLevel } from '../state/progress';
import type { Progress } from '../state/progress';
import { LANE_LABEL } from '../engine/types';
import type { Lane } from '../engine/types';
import ChartPreview from './ChartPreview';
import Icon from './Icon';
import Stars from './Stars';

interface Props {
  progress: Progress;
  onPlay: (songId: string, mode: GameMode, level?: number) => void;
}

interface Working {
  id: string;
  createdAt: number;
  name: string;
  file: File;
  /** analysis at the detected tempo; levels re-track from it on a tempo override */
  base: ChartAnalysis | null;
  autoBpm: number;
  settings: SongSettings;
  levels: SongLevel[];
}

const fmtSec = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export default function SongLibrary({ progress, onPlay }: Props) {
  const [songs, setSongs] = useState<SongMeta[]>([]);
  const [working, setWorking] = useState<Working | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [stage, setStage] = useState<{ stage: string; p: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recharting, setRecharting] = useState<string | null>(null);
  const [bpmText, setBpmText] = useState('');
  /** level picked on each song card (defaults to the next one to beat) */
  const [picked, setPicked] = useState<Record<string, number>>({});
  const fileRef = useRef<HTMLInputElement | null>(null);
  const tapsRef = useRef<number[]>([]);

  const refresh = useCallback(() => {
    void listSongs().then(setSongs);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onFile = async (f: File | null) => {
    if (!f) return;
    setError(null);
    const name = f.name.replace(/\.[^.]+$/, '');
    const createdAt = Date.now();
    const id = `song-${createdAt.toString(36)}`;
    try {
      setBusy('Decoding');
      setStage(null);
      const buffer = await decodeAudioFile(f);
      setWorking({ id, createdAt, name, file: f, base: null, autoBpm: 0, settings: DEFAULT_SETTINGS, levels: [] });
      setBusy('Analyzing');
      const a = await analyzeInWorker(monoSamples(buffer), {}, (s, p) => setStage({ stage: s, p }));
      const levels = songLevels(a, DEFAULT_SETTINGS, name, id);
      const autoBpm = levels[0]?.chart.bpm ?? 0;
      setWorking({ id, createdAt, name, file: f, base: a, autoBpm, settings: DEFAULT_SETTINGS, levels });
      setBpmText(String(autoBpm));
    } catch (e) {
      setWorking(null);
      setError(
        e instanceof DOMException || (e instanceof Error && /decode/i.test(e.message))
          ? 'Could not decode that file. Try MP3, M4A, WAV or OGG.'
          : `Analysis failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setBusy(null);
      setStage(null);
    }
  };

  const update = (next: Partial<SongSettings>) => {
    const w = working;
    if (!w?.base) return;
    const settings = { ...w.settings, ...next };
    // level only changes which chart is previewed; tempo and sensitivity rebuild them all
    const levels = next.level !== undefined && Object.keys(next).length === 1 ? w.levels : songLevels(w.base, settings, w.name, w.id);
    setWorking({ ...w, settings, levels });
    if (next.bpm !== undefined) setBpmText(String(levels[0]?.chart.bpm ?? ''));
  };

  const preview = working ? pickLevel(working.levels, working.settings.level) : undefined;

  const commitBpm = () => {
    const v = Number(bpmText);
    if (Number.isFinite(v) && v >= 40 && v <= 260) update({ bpm: Math.round(v * 10) / 10 });
    else setBpmText(String(preview?.chart.bpm ?? ''));
  };

  const tap = () => {
    const now = performance.now();
    const t = tapsRef.current;
    if (t.length && now - t[t.length - 1] > 2000) t.length = 0;
    t.push(now);
    if (t.length > 8) t.shift();
    if (t.length >= 4) {
      const avg = (t[t.length - 1] - t[0]) / (t.length - 1);
      update({ bpm: Math.round(60000 / avg) });
    }
  };

  const save = async (): Promise<{ id: string; level: number } | null> => {
    if (!working?.base || !preview) return null;
    setBusy('Saving');
    const { id, createdAt, name, base, settings } = working;
    const level = preview.level;
    await putSong({
      id,
      title: name,
      createdAt,
      bytes: await working.file.arrayBuffer(),
      settings: { ...settings, level },
      chart: { ...preview.chart, id },
      analysis: base,
    });
    setWorking(null);
    setBusy(null);
    refresh();
    return { id, level };
  };

  const rechart = async (id: string) => {
    setRecharting(id);
    setError(null);
    try {
      const stored = await getSong(id);
      if (!stored) return;
      const buffer = await decodeAudioBytes(stored.bytes);
      const a = await analyzeInWorker(monoSamples(buffer));
      const settings = normalizeSettings(stored.settings);
      const lv = pickLevel(songLevels(a, settings, stored.title, id), settings.level);
      if (!lv) throw new Error('no drums found');
      await putSong({ ...stored, settings, chart: { ...lv.chart, id }, analysis: a });
      refresh();
    } catch (e) {
      setError(`Re-chart failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRecharting(null);
    }
  };

  const laneCounts = (chart: SongChart) => {
    const out: Record<string, number> = {};
    for (const n of chart.notes) out[n.lane] = (out[n.lane] ?? 0) + 1;
    return out;
  };

  const analyzing = busy === 'Decoding' || busy === 'Analyzing';
  const pct = stage ? Math.round(stage.p * 100) : 0;

  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac"
      hidden
      onChange={(e) => {
        void onFile(e.target.files?.[0] ?? null);
        e.target.value = '';
      }}
    />
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Songs</h1>
          <p>Import a track and the drum part is transcribed on this computer, then laid out as levels from the pulse to the full part.</p>
        </div>
        {!working && (
          <button type="button" className="btn btn-primary" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" />
            Import song
          </button>
        )}
        {fileInput}
      </div>

      {working && (
        <section className="surface import-panel" aria-label="Import">
          <div className="import-head">
            <div>
              <h2>{working.name}</h2>
              {preview && (
                <p className="faint" style={{ fontSize: 12.5, marginTop: 2 }}>
                  <span className="mono">{fmtSec(preview.chart.durationSec)}</span> ·{' '}
                  <span className="mono">{preview.chart.bpm}</span> bpm · {working.levels.length} levels
                </p>
              )}
            </div>
            <button type="button" className="btn btn-quiet btn-icon" aria-label="Cancel import" onClick={() => setWorking(null)} disabled={analyzing}>
              <Icon name="close" />
            </button>
          </div>

          {analyzing && (
            <div className="analyze" role="status">
              <div className="analyze-label">
                <span>{stage?.stage ?? (busy === 'Decoding' ? 'Decoding audio' : 'Loading the drum model')}…</span>
                <span className="mono">{stage ? `${pct}%` : ''}</span>
              </div>
              <div className="meter">
                <span style={{ width: `${stage ? pct : 3}%` }} />
              </div>
            </div>
          )}

          {preview && (
            <>
              <div className="import-grid">
                <div>
                  <div className="seg" role="group" aria-label="Preview level">
                    {working.levels.map((l) => (
                      <button key={l.level} type="button" aria-pressed={preview.level === l.level} onClick={() => update({ level: l.level })}>
                        <span className="num">{l.level}</span>
                        {l.name}
                      </button>
                    ))}
                  </div>
                  <p className="level-blurb">
                    {preview.blurb}. Every level is saved; this is just a preview.
                  </p>
                  <div style={{ marginTop: 14 }}>
                    <ChartPreview chart={preview.chart} />
                  </div>
                  <div className="import-stats" style={{ marginTop: 12 }}>
                    <span>
                      <b className="mono" style={{ color: 'var(--text)' }}>
                        {preview.chart.notes.length}
                      </b>{' '}
                      notes · <span className="mono">{(preview.chart.notes.length / preview.chart.durationSec).toFixed(1)}</span>/s
                    </span>
                    {Object.entries(laneCounts(preview.chart)).map(([lane, c]) => (
                      <span key={lane}>
                        <span className="dot" style={{ background: `var(--${lane.toLowerCase()})` }} />
                        {LANE_LABEL[lane as Lane] ?? lane} <span className="mono faint">{c}</span>
                      </span>
                    ))}
                  </div>
                </div>

                <div className="import-side">
                  <label className="field">
                    <span>
                      Tempo <span className="field-hint">{working.settings.bpm === 0 ? 'detected' : 'set by you'}</span>
                    </span>
                    <span style={{ display: 'flex', gap: 6 }}>
                      <input
                        type="number"
                        className="input mono"
                        style={{ flex: 1, minWidth: 0 }}
                        min={40}
                        max={260}
                        step={0.1}
                        value={bpmText}
                        onChange={(e) => setBpmText(e.target.value)}
                        onBlur={commitBpm}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitBpm();
                        }}
                      />
                      <button type="button" className="btn" onClick={tap} title="Tap along to the beat 4 or more times">
                        Tap
                      </button>
                      {working.settings.bpm !== 0 && (
                        <button type="button" className="btn btn-quiet" onClick={() => update({ bpm: 0 })} title={`Back to the detected ${working.autoBpm} bpm`}>
                          Auto
                        </button>
                      )}
                    </span>
                  </label>
                  <label className="field">
                    <span>
                      Sensitivity <span className="field-hint mono">{working.settings.sensitivity.toFixed(2)}×</span>
                    </span>
                    <input
                      type="range"
                      min={50}
                      max={200}
                      step={5}
                      value={Math.round(working.settings.sensitivity * 100)}
                      onChange={(e) => update({ sensitivity: Number(e.target.value) / 100 })}
                    />
                    <span className="range-ends">
                      <span>Fewer, surer hits</span>
                      <span>Quieter hits too</span>
                    </span>
                  </label>
                </div>
              </div>

              <div className="import-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy !== null}
                  onClick={() => {
                    void save().then((s) => s && onPlay(s.id, 'performance', s.level));
                  }}
                >
                  <Icon name="play" />
                  Save and play {preview.name}
                </button>
                <button type="button" className="btn" onClick={() => void save()} disabled={busy !== null}>
                  Save
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {error && <p className="notice">{error}</p>}

      {songs.length === 0 && !working ? (
        <div className="empty">
          <h2>No songs yet</h2>
          <p style={{ marginBottom: 18 }}>MP3, M4A, WAV or OGG. Nothing is uploaded.</p>
          <button type="button" className="btn btn-primary" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" />
            Import a song
          </button>
        </div>
      ) : (
        <ul className="row-list">
          {songs.map((s) => {
            const busyHere = recharting === s.id;
            const hasLevels = s.levels.length > 0;
            const sel = hasLevels ? (pickLevel(s.levels, picked[s.id] ?? nextSongLevel(progress, s.id, s.levels)) ?? s.levels[0]) : null;
            const rec = progress.lessons[sel ? levelId(s.id, sel.level) : s.id];
            const passed = s.levels.filter((l) => (progress.lessons[levelId(s.id, l.level)]?.stars ?? 0) > 0).length;
            return (
              <li key={s.id} className="song-row">
                <div style={{ minWidth: 0 }}>
                  <div className="song-title">{s.title}</div>
                  <div className="song-meta">
                    <span className="mono">{fmtSec(s.durationSec)}</span> · <span className="mono">{s.bpm}</span> bpm
                    {hasLevels ? (
                      <>
                        {' '}
                        · {passed} of {s.levels.length} levels passed
                        {rec && rec.plays > 0 && (
                          <>
                            {' '}
                            · best <span className="mono">{Math.round(rec.bestAcc * 100)}%</span>
                          </>
                        )}
                      </>
                    ) : (
                      <span className="warn"> · charted before levels; re-chart to get them</span>
                    )}
                  </div>
                </div>

                {hasLevels && sel ? (
                  <div className="ladder" role="radiogroup" aria-label={`${s.title} level`}>
                    {s.levels.map((l) => (
                      <button
                        key={l.level}
                        type="button"
                        role="radio"
                        aria-checked={sel.level === l.level}
                        onClick={() => setPicked((p) => ({ ...p, [s.id]: l.level }))}
                        title={`${l.name}: ${l.blurb} (${l.notes} notes)`}
                      >
                        <span className="step">{l.name}</span>
                        <Stars count={3} filled={progress.lessons[levelId(s.id, l.level)]?.stars ?? 0} size={10} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <span />
                )}

                <div className="song-actions">
                  <button type="button" className="btn btn-primary" onClick={() => onPlay(s.id, 'performance', sel?.level)} disabled={busyHere}>
                    <Icon name="play" />
                    Play
                  </button>
                  <button type="button" className="btn" onClick={() => onPlay(s.id, 'practice', sel?.level)} disabled={busyHere} title="Practice: loop sections, slow down">
                    Practice
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet btn-icon"
                    onClick={() => void rechart(s.id)}
                    disabled={recharting !== null}
                    aria-label={`Re-chart ${s.title}`}
                    title={busyHere ? 'Re-charting…' : 'Transcribe again with the current drum model'}
                  >
                    <Icon name="refresh" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet btn-icon"
                    aria-label={`Delete ${s.title}`}
                    title="Delete"
                    onClick={() => {
                      void deleteSong(s.id).then(refresh);
                    }}
                    disabled={busyHere}
                  >
                    <Icon name="trash" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="credit">
        Drum detection: ADTOF model (Zehren, Alunno & Bientinesi, 2023), CC BY-NC-SA 4.0. Audio never leaves this computer.
      </p>
    </>
  );
}
