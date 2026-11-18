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
import Stars from './Stars';

interface Props {
  progress: Progress;
  onBack: () => void;
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

export default function SongLibrary({ progress, onBack, onPlay }: Props) {
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

  return (
    <div className="app">
      <div className="view-head">
        <button type="button" className="back-link" onClick={onBack}>
          ← Back
        </button>
        <div>
          <h2 style={{ fontSize: 26 }}>🎧 My songs</h2>
          <p style={{ color: 'var(--muted)', fontSize: 14, margin: '4px 0 0' }}>
            Import any track: the drum part is transcribed on your machine and becomes a ladder of levels, from the
            pulse to the full part.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac"
          style={{ display: 'none' }}
          onChange={(e) => {
            void onFile(e.target.files?.[0] ?? null);
            e.target.value = '';
          }}
        />
        {!working ? (
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn primary big" onClick={() => fileRef.current?.click()}>
              ＋ Import a song (MP3 / M4A / WAV)
            </button>
            <span style={{ color: 'var(--muted)', fontSize: 13.5 }}>
              Finds kick, snare, hats, toms and cymbals, follows the beat, then builds levels you can climb.
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 16 }}>{working.name}</b>
              <button type="button" className="btn ghost" onClick={() => setWorking(null)} disabled={analyzing}>
                ✕ Cancel
              </button>
            </div>

            {analyzing && (
              <div className="analyze-progress" role="status">
                <div className="analyze-label">
                  <span>{stage?.stage ?? (busy === 'Decoding' ? 'Decoding audio' : 'Loading the drum model')}…</span>
                  <span>{stage ? `${pct}%` : ''}</span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${stage ? pct : 4}%` }} />
                </div>
              </div>
            )}

            {preview && (
              <>
                <div className="ctl-row">
                  {working.levels.length} levels: every one is saved, preview any of them
                  <div className="mode-switch level-switch">
                    {working.levels.map((l) => (
                      <button
                        key={l.level}
                        type="button"
                        className={`btn${preview.level === l.level ? ' active' : ''}`}
                        onClick={() => update({ level: l.level })}
                        title={l.blurb}
                      >
                        <span className="level-num">{l.level}</span> {l.name}
                      </button>
                    ))}
                  </div>
                  <span style={{ fontWeight: 500, fontSize: 12.5 }}>{preview.blurb}</span>
                </div>

                <ChartPreview chart={preview.chart} />

                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <label className="ctl-row" style={{ flex: 1, minWidth: 150 }}>
                    Tempo (BPM){working.settings.bpm === 0 ? ' · detected' : ' · set by you'}
                    <input
                      type="number"
                      className="ctl"
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
                  </label>
                  <button type="button" className="btn" onClick={tap} title="Tap along to the beat 4+ times">
                    👆 Tap
                  </button>
                  {working.settings.bpm !== 0 && (
                    <button type="button" className="btn ghost" onClick={() => update({ bpm: 0 })}>
                      Auto ({working.autoBpm})
                    </button>
                  )}
                  <label className="ctl-row" style={{ flex: 2, minWidth: 200 }}>
                    Sensitivity: {working.settings.sensitivity.toFixed(2)}×
                    <input
                      type="range"
                      min={50}
                      max={200}
                      step={5}
                      value={Math.round(working.settings.sensitivity * 100)}
                      onChange={(e) => update({ sensitivity: Number(e.target.value) / 100 })}
                    />
                    <span className="vals">
                      <span>fewer, surer hits</span>
                      <span>quieter hits too</span>
                    </span>
                  </label>
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className="pill">
                    {preview.chart.notes.length} notes · {(preview.chart.notes.length / preview.chart.durationSec).toFixed(1)}/s
                  </span>
                  {Object.entries(laneCounts(preview.chart)).map(([lane, c]) => (
                    <span key={lane} className="pill" style={{ color: `var(--${lane.toLowerCase()})` }}>
                      {LANE_LABEL[lane as Lane] ?? lane}: {c}
                    </span>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button type="button" className="btn primary big" onClick={() => void save()} disabled={busy !== null}>
                    💾 Save
                  </button>
                  <button
                    type="button"
                    className="btn big"
                    disabled={busy !== null}
                    onClick={() => {
                      void save().then((s) => s && onPlay(s.id, 'performance', s.level));
                    }}
                  >
                    ▶ Save &amp; play {preview.name}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {error && <p className="import-error">{error}</p>}
        <p className="credit">
          Drum detection: ADTOF model (Zehren, Alunno &amp; Bientinesi, 2023), CC BY-NC-SA 4.0. Audio never leaves
          this computer.
        </p>
      </div>

      <div className="lesson-list">
        {songs.map((s) => {
          const busyHere = recharting === s.id;
          const hasLevels = s.levels.length > 0;
          const sel = hasLevels ? (pickLevel(s.levels, picked[s.id] ?? nextSongLevel(progress, s.id, s.levels)) ?? s.levels[0]) : null;
          const rec = progress.lessons[sel ? levelId(s.id, sel.level) : s.id];
          const passed = s.levels.filter((l) => (progress.lessons[levelId(s.id, l.level)]?.stars ?? 0) > 0).length;
          return (
            <div key={s.id} className="card lesson-card" style={{ cursor: 'default' }}>
              <div className="top">
                {hasLevels ? (
                  <span className="pill">
                    {passed}/{s.levels.length} levels passed
                  </span>
                ) : (
                  <Stars count={3} filled={rec?.stars ?? 0} />
                )}
                <span className="pill">{s.bpm} BPM</span>
              </div>
              <h3>{s.title}</h3>
              <p>
                {fmtSec(s.durationSec)}
                {!hasLevels && <span className="old-chart"> · old chart, re-chart it to get levels</span>}
              </p>
              {hasLevels && sel && (
                <>
                  <div className="level-ladder" role="radiogroup" aria-label={`${s.title} levels`}>
                    {s.levels.map((l) => {
                      const stars = progress.lessons[levelId(s.id, l.level)]?.stars ?? 0;
                      return (
                        <button
                          key={l.level}
                          type="button"
                          role="radio"
                          aria-checked={sel.level === l.level}
                          className={`level-chip${sel.level === l.level ? ' active' : ''}`}
                          onClick={() => setPicked((p) => ({ ...p, [s.id]: l.level }))}
                          title={`${l.name}: ${l.blurb} (${l.notes} notes)`}
                        >
                          <span className="level-num">{l.level}</span>
                          <span className="level-name">{l.name}</span>
                          <Stars count={3} filled={stars} size={11} />
                        </button>
                      );
                    })}
                  </div>
                  <p className="level-blurb">
                    {sel.blurb} · {sel.notes} notes
                  </p>
                </>
              )}
              <div className="meta" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => onPlay(s.id, 'performance', sel?.level)}
                  disabled={busyHere}
                >
                  ▶ Play{sel ? ` ${sel.name}` : ''}
                </button>
                <button type="button" className="btn" onClick={() => onPlay(s.id, 'practice', sel?.level)} disabled={busyHere}>
                  🎯 Practice
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => void rechart(s.id)}
                  disabled={recharting !== null}
                  title="Transcribe this song again with the current drum model"
                >
                  {busyHere ? 'Re-charting…' : '↻ Re-chart'}
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  aria-label={`Delete ${s.title}`}
                  onClick={() => {
                    void deleteSong(s.id).then(refresh);
                  }}
                  disabled={busyHere}
                >
                  🗑
                </button>
                {rec && rec.plays > 0 && (
                  <span style={{ color: 'var(--muted)', fontSize: 12.5, fontWeight: 600 }}>
                    best {(rec.bestAcc * 100).toFixed(0)}%
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {songs.length === 0 && !working && <p style={{ color: 'var(--muted)' }}>No songs yet. Import one above.</p>}
      </div>
    </div>
  );
}
