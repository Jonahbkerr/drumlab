import { useCallback, useEffect, useRef, useState } from 'react';
import { analyze, decodeAudioFile, detectBpm, generateChart } from '../engine/transcribe';
import type { Analysis, SongChart, SongSettings } from '../engine/transcribe';
import type { GameMode } from '../engine/game';
import { deleteSong, listSongs, putSong } from '../engine/songstore';
import type { SongMeta } from '../engine/songstore';
import type { Progress } from '../state/progress';
import Stars from './Stars';

interface Props {
  progress: Progress;
  onBack: () => void;
  onPlay: (songId: string, mode: GameMode) => void;
}

interface Working {
  name: string;
  buffer: AudioBuffer;
  analysis: Analysis;
  settings: SongSettings;
  chart: SongChart | null;
}

const fmtSec = (s: number) => {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
};

export default function SongLibrary({ progress, onBack, onPlay }: Props) {
  const [songs, setSongs] = useState<SongMeta[]>([]);
  const [working, setWorking] = useState<Working | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const fileBytesRef = useRef<File | null>(null);
  const tapsRef = useRef<number[]>([]);

  const refresh = useCallback(() => {
    void listSongs().then(setSongs);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onFile = async (f: File | null) => {
    if (!f) return;
    try {
      setBusy('Decoding…');
      const buffer = await decodeAudioFile(f);
      setBusy('Analyzing…');
      await new Promise((r) => setTimeout(r, 30)); // let the label paint
      const analysis = analyze(buffer);
      const autoBpm = Math.round(detectBpm(analysis) ?? 120);
      fileBytesRef.current = f;
      setWorking({
        name: f.name.replace(/\.[^.]+$/, ''),
        buffer,
        analysis,
        settings: { bpm: autoBpm, threshold: 1, density: 0.55 },
        chart: null,
      });
      setBusy(null);
    } catch {
      setBusy(null);
      setWorking(null);
      alert('Could not decode that file. Try MP3, M4A, WAV or OGG.');
    }
  };

  const generate = () => {
    if (!working) return;
    setBusy('Generating chart…');
    setTimeout(() => {
      const chart = generateChart(working.buffer, working.settings, working.analysis);
      chart.title = working.name;
      setWorking({ ...working, chart });
      setBusy(null);
    }, 40);
  };

  const save = async () => {
    if (!working?.chart || !fileBytesRef.current) return;
    setBusy('Saving…');
    const bytes = await fileBytesRef.current.arrayBuffer();
    await putSong({
      id: working.chart.id,
      title: working.name,
      createdAt: Date.now(),
      bytes,
      settings: working.settings,
      chart: working.chart,
    });
    setWorking(null);
    fileBytesRef.current = null;
    setBusy(null);
    refresh();
  };

  const tap = () => {
    const now = performance.now();
    const t = tapsRef.current;
    t.push(now);
    if (t.length > 8) t.shift();
    if (t.length >= 2) {
      const intervals = t.slice(1).map((v, i) => v - t[i]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      setWorking((w) => (w ? { ...w, settings: { ...w.settings, bpm: Math.round(60000 / avg) } } : w));
    }
  };

  const laneCounts = (chart: SongChart | null) => {
    const out: Record<string, number> = {};
    if (!chart) return out;
    for (const n of chart.notes) out[n.lane] = (out[n.lane] ?? 0) + 1;
    return out;
  };

  return (
    <div className="app">
      <div className="view-head">
        <button type="button" className="back-link" onClick={onBack}>
          ← Back
        </button>
        <div>
          <h2 style={{ fontSize: 26 }}>🎧 My songs</h2>
          <p style={{ color: 'var(--muted)', fontSize: 14, margin: '4px 0 0' }}>
            Import any track — it stays on your machine and becomes a playable drum chart.
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
              Auto-detects tempo and drum hits, then charts the lanes.
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 16 }}>{working.name}</b>
              <button type="button" className="btn ghost" onClick={() => { setWorking(null); fileBytesRef.current = null; }}>
                ✕ Cancel
              </button>
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label className="ctl-row" style={{ flex: 1, minWidth: 140 }}>
                Tempo (BPM)
                <input
                  type="number"
                  className="ctl"
                  min={40}
                  max={260}
                  value={working.settings.bpm}
                  onChange={(e) =>
                    setWorking({
                      ...working,
                      settings: { ...working.settings, bpm: Number(e.target.value) || 0 },
                    })
                  }
                />
              </label>
              <button type="button" className="btn" onClick={tap}>
                👆 Tap
              </button>
              <label className="ctl-row" style={{ flex: 2, minWidth: 200 }}>
                Sensitivity — {working.settings.threshold.toFixed(2)}×
                <input
                  type="range"
                  min={50}
                  max={200}
                  step={5}
                  value={Math.round(working.settings.threshold * 100)}
                  onChange={(e) =>
                    setWorking({
                      ...working,
                      settings: { ...working.settings, threshold: Number(e.target.value) / 100 },
                    })
                  }
                />
              </label>
              <label className="ctl-row" style={{ flex: 2, minWidth: 200 }}>
                Density — {Math.round(working.settings.density * 100)}%
                <input
                  type="range"
                  min={20}
                  max={100}
                  step={5}
                  value={Math.round(working.settings.density * 100)}
                  onChange={(e) =>
                    setWorking({
                      ...working,
                      settings: { ...working.settings, density: Number(e.target.value) / 100 },
                    })
                  }
                />
              </label>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" className="btn primary" onClick={generate} disabled={busy !== null}>
                {busy ?? (working.chart ? '↻ Regenerate' : 'Generate chart')}
              </button>
              {working.chart && (
                <>
                  <span className="pill">{working.chart.notes.length} notes</span>
                  {Object.entries(laneCounts(working.chart)).map(([lane, c]) => (
                    <span key={lane} className="pill" style={{ color: 'var(--text)' }}>
                      {lane}: {c}
                    </span>
                  ))}
                </>
              )}
            </div>

            {working.chart && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button type="button" className="btn primary big" onClick={() => void save()}>
                  💾 Save
                </button>
                <button
                  type="button"
                  className="btn big"
                  onClick={() => {
                    void save().then(() => onPlay(working.chart!.id, 'performance'));
                  }}
                >
                  ▶ Save &amp; play
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="lesson-list">
        {songs.map((s) => {
          const rec = progress.lessons[s.id];
          return (
            <div key={s.id} className="card lesson-card" style={{ cursor: 'default' }}>
              <div className="top">
                <Stars count={3} filled={rec?.stars ?? 0} />
                <span className="pill">{s.bpm} BPM</span>
              </div>
              <h3>{s.title}</h3>
              <p>
                {fmtSec(s.durationSec)} · {s.noteCount} notes
              </p>
              <div className="meta" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn primary" onClick={() => onPlay(s.id, 'performance')}>
                  ▶ Play
                </button>
                <button type="button" className="btn" onClick={() => onPlay(s.id, 'practice')}>
                  🎯 Practice
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    void deleteSong(s.id).then(refresh);
                  }}
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
        {songs.length === 0 && !working && (
          <p style={{ color: 'var(--muted)' }}>No songs yet — import one above.</p>
        )}
      </div>
    </div>
  );
}
