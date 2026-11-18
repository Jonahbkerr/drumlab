import { useCallback, useEffect, useRef, useState } from 'react';
import { analyzeInWorker } from '../engine/chart/client';
import { retrack } from '../engine/chart/pipeline';
import type { ChartAnalysis } from '../engine/chart/pipeline';
import type { GameMode } from '../engine/game';
import { deleteSong, getSong, listSongs, putSong } from '../engine/songstore';
import type { SongMeta } from '../engine/songstore';
import {
  DEFAULT_SETTINGS,
  LEVELS,
  buildSongChart,
  decodeAudioBytes,
  decodeAudioFile,
  monoSamples,
  normalizeSettings,
} from '../engine/transcribe';
import type { SongChart, SongSettings } from '../engine/transcribe';
import type { Progress } from '../state/progress';
import { LANE_LABEL } from '../engine/types';
import type { Lane } from '../engine/types';
import ChartPreview from './ChartPreview';
import Stars from './Stars';

interface Props {
  progress: Progress;
  onBack: () => void;
  onPlay: (songId: string, mode: GameMode) => void;
}

interface Working {
  name: string;
  file: File;
  /** analysis at the detected tempo; tempo overrides re-track from it */
  base: ChartAnalysis | null;
  analysis: ChartAnalysis | null;
  autoBpm: number;
  settings: SongSettings;
  chart: SongChart | null;
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
    try {
      setBusy('Decoding');
      setStage(null);
      const buffer = await decodeAudioFile(f);
      setWorking({ name, file: f, base: null, analysis: null, autoBpm: 0, settings: DEFAULT_SETTINGS, chart: null });
      setBusy('Analyzing');
      const a = await analyzeInWorker(monoSamples(buffer), {}, (s, p) => setStage({ stage: s, p }));
      const chart = buildSongChart(a, DEFAULT_SETTINGS, name);
      setWorking({ name, file: f, base: a, analysis: a, autoBpm: chart.bpm, settings: DEFAULT_SETTINGS, chart });
      setBpmText(String(chart.bpm));
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
    const analysis = next.bpm !== undefined ? retrack(w.base, settings.bpm) : (w.analysis ?? w.base);
    const chart = buildSongChart(analysis, settings, w.name, w.chart?.id);
    setWorking({ ...w, settings, analysis, chart });
    if (next.bpm !== undefined) setBpmText(String(chart.bpm));
  };

  const commitBpm = () => {
    const v = Number(bpmText);
    if (Number.isFinite(v) && v >= 40 && v <= 260) update({ bpm: Math.round(v * 10) / 10 });
    else setBpmText(String(working?.chart?.bpm ?? ''));
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

  const save = async (): Promise<string | null> => {
    if (!working?.chart) return null;
    setBusy('Saving');
    const chart = working.chart;
    await putSong({
      id: chart.id,
      title: working.name,
      createdAt: Date.now(),
      bytes: await working.file.arrayBuffer(),
      settings: working.settings,
      chart,
    });
    setWorking(null);
    setBusy(null);
    refresh();
    return chart.id;
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
      const analysis = settings.bpm > 0 ? retrack(a, settings.bpm) : a;
      await putSong({ ...stored, settings, chart: buildSongChart(analysis, settings, stored.title, id) });
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
            Import any track: the drum part is transcribed on your machine and becomes a playable chart.
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
              Finds kick, snare, hats, toms and cymbals, follows the beat, then charts it at your level.
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

            {working.chart && (
              <>
                <div className="ctl-row">
                  Difficulty
                  <div className="mode-switch">
                    {LEVELS.map((l) => (
                      <button
                        key={l.level}
                        type="button"
                        className={`btn${working.settings.level === l.level ? ' active' : ''}`}
                        onClick={() => update({ level: l.level })}
                        title={l.blurb}
                      >
                        {l.name}
                      </button>
                    ))}
                  </div>
                  <span style={{ fontWeight: 500, fontSize: 12.5 }}>
                    {LEVELS.find((l) => l.level === working.settings.level)?.blurb}
                  </span>
                </div>

                <ChartPreview chart={working.chart} />

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
                    {working.chart.notes.length} notes · {(working.chart.notes.length / working.chart.durationSec).toFixed(1)}/s
                  </span>
                  {Object.entries(laneCounts(working.chart)).map(([lane, c]) => (
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
                      void save().then((id) => id && onPlay(id, 'performance'));
                    }}
                  >
                    ▶ Save &amp; play
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
          const rec = progress.lessons[s.id];
          const busyHere = recharting === s.id;
          return (
            <div key={s.id} className="card lesson-card" style={{ cursor: 'default' }}>
              <div className="top">
                <Stars count={3} filled={rec?.stars ?? 0} />
                <span className="pill">{s.bpm} BPM</span>
              </div>
              <h3>{s.title}</h3>
              <p>
                {fmtSec(s.durationSec)} · {s.noteCount} notes
                {!s.modern && <span className="old-chart"> · old chart, re-chart it</span>}
              </p>
              <div className="meta" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn primary" onClick={() => onPlay(s.id, 'performance')} disabled={busyHere}>
                  ▶ Play
                </button>
                <button type="button" className="btn" onClick={() => onPlay(s.id, 'practice')} disabled={busyHere}>
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
