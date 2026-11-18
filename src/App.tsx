import { useCallback, useEffect, useState } from 'react';
import type { GameMode, RunResult } from './engine/game';
import { PATHS, lessonById, lessonsInPath } from './content/lessons';
import { loadProgress, recordResult, saveProgress } from './state/progress';
import type { Progress } from './state/progress';
import { decodeAudioBytes, normalizeSettings, parseLevelId, pickLevel, songLevels } from './engine/transcribe';
import { fitToContext } from './engine/stretch';
import { sharedAudio } from './engine/audio';
import { getSong } from './engine/songstore';
import type { SongChart, SongLevel } from './engine/transcribe';
import Home from './ui/Home';
import Shell from './ui/Shell';
import type { Section } from './ui/Shell';
import PlayView from './ui/PlayView';
import ResultsView from './ui/ResultsView';
import KitSetup from './ui/KitSetup';
import SongLibrary from './ui/SongLibrary';

type View =
  | { name: 'learn' }
  | { name: 'play'; lessonId: string; mode?: GameMode }
  | { name: 'kit' }
  | { name: 'songs' }
  | { name: 'songplay'; songId: string; mode: GameMode; level?: number }
  | { name: 'results'; lessonId: string; result: RunResult; title?: string; next?: { level: number; name: string } };

export default function App() {
  const [progress, setProgress] = useState<Progress>(loadProgress);
  const [view, setView] = useState<View>({ name: 'learn' });
  const [prevBest, setPrevBest] = useState<number | null>(null);

  const handleFinish = useCallback((r: RunResult, title?: string, next?: { level: number; name: string }) => {
    const isPerformance = r.mode === 'performance';
    setPrevBest(isPerformance ? (loadProgress().lessons[r.lessonId]?.bestAcc ?? 0) : null);
    setProgress((p) => {
      const next = recordResult(p, r.lessonId, r, isPerformance);
      saveProgress(next);
      return next;
    });
    setView({ name: 'results', lessonId: r.lessonId, result: r, title, next });
  }, []);

  const nav = (s: Section) => setView({ name: s } as View);

  if (view.name === 'learn') {
    return (
      <Shell section="learn" progress={progress} onNav={nav}>
        <Home progress={progress} onPlay={(lessonId) => setView({ name: 'play', lessonId })} />
      </Shell>
    );
  }

  if (view.name === 'kit') {
    return (
      <Shell section="kit" progress={progress} onNav={nav}>
        <KitSetup />
      </Shell>
    );
  }

  if (view.name === 'songs') {
    return (
      <Shell section="songs" progress={progress} onNav={nav}>
        <SongLibrary
          progress={progress}
          onPlay={(songId, mode, level) => setView({ name: 'songplay', songId, mode, level })}
        />
      </Shell>
    );
  }

  if (view.name === 'songplay') {
    return (
      <SongPlay
        key={view.songId}
        songId={view.songId}
        mode={view.mode}
        level={view.level}
        onLevel={(level, mode) => setView({ ...view, level, mode })}
        onFinish={handleFinish}
        onQuit={() => setView({ name: 'songs' })}
      />
    );
  }

  const lesson = view.name === 'play' || view.name === 'results' ? lessonById(view.lessonId) : undefined;

  if (view.name === 'play' && lesson) {
    return (
      <PlayView
        key={`${lesson.id}:${view.mode ?? 'performance'}`}
        lesson={lesson}
        song={null}
        initialMode={view.mode}
        onFinish={handleFinish}
        onQuit={() => setView({ name: 'learn' })}
      />
    );
  }

  if (view.name === 'results') {
    const title = view.title ?? lesson?.title ?? 'Song';
    const isBest = prevBest !== null && view.result.accuracy > prevBest && view.result.mode === 'performance';
    if (lesson) {
      const siblings = lessonsInPath(lesson.pathId);
      const idx = siblings.findIndex((l) => l.id === lesson.id);
      const nextLesson = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
      return (
        <Shell section={null} progress={progress} onNav={nav}>
          <ResultsView
            title={title}
            kicker={PATHS.find((p) => p.id === lesson.pathId)?.name ?? 'Lesson'}
            result={view.result}
            isBest={isBest}
            nextLabel={nextLesson ? `Next: ${nextLesson.title}` : undefined}
            onRetry={() => setView({ name: 'play', lessonId: lesson.id, mode: view.result.mode })}
            onNext={() => nextLesson && setView({ name: 'play', lessonId: nextLesson.id })}
            onHome={() => setView({ name: 'learn' })}
            homeLabel="Back to lessons"
          />
        </Shell>
      );
    }
    // song results: retry this level, or step up to the next one
    const { songId, level } = parseLevelId(view.lessonId);
    const next = view.next;
    return (
      <Shell section={null} progress={progress} onNav={nav}>
        <ResultsView
          title={title}
          kicker="Song"
          result={view.result}
          isBest={isBest}
          nextLabel={next ? `Next level: ${next.name}` : undefined}
          onRetry={() => setView({ name: 'songplay', songId, mode: view.result.mode, level: level ?? undefined })}
          onNext={() => next && setView({ name: 'songplay', songId, mode: 'performance', level: next.level })}
          onHome={() => setView({ name: 'songs' })}
          homeLabel="Back to songs"
        />
      </Shell>
    );
  }

  return null;
}

function SongPlay({
  songId,
  mode,
  level,
  onLevel,
  onFinish,
  onQuit,
}: {
  songId: string;
  mode: GameMode;
  level?: number;
  onLevel: (level: number, mode: GameMode) => void;
  onFinish: (r: RunResult, title?: string, next?: { level: number; name: string }) => void;
  onQuit: () => void;
}) {
  const [loaded, setLoaded] = useState<{
    chart: SongChart;
    buffer: AudioBuffer;
    title: string;
    levels: SongLevel[];
    defaultLevel: number;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const s = await getSong(songId);
        if (!s) throw new Error('Song not found — it may have been deleted.');
        const decoded = await decodeAudioBytes(s.bytes);
        // playback context may run at 24/48k — resample so SongTouch and the
        // plain fallback both play at true speed
        const buffer = await fitToContext(decoded, sharedAudio.sampleRate());
        const settings = normalizeSettings(s.settings);
        const levels = s.analysis ? songLevels(s.analysis, settings, s.title, s.id) : [];
        if (!cancelled) setLoaded({ chart: s.chart, buffer, title: s.title, levels, defaultLevel: settings.level });
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [songId]);

  if (err) {
    return (
      <div className="loading">
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--bad)', marginBottom: 14 }}>{err}</p>
          <button type="button" className="btn" onClick={onQuit}>
            Back to songs
          </button>
        </div>
      </div>
    );
  }
  if (!loaded) {
    return <div className="loading">Loading song…</div>;
  }
  // songs charted before levels existed play their single saved chart
  const current = pickLevel(loaded.levels, level ?? loaded.defaultLevel);
  const chart = current?.chart ?? loaded.chart;
  const title = current ? `${loaded.title} · ${current.name}` : loaded.title;
  const idx = current ? loaded.levels.indexOf(current) : -1;
  const next = idx >= 0 ? loaded.levels[idx + 1] : undefined;
  return (
    <PlayView
      key={chart.id}
      lesson={null}
      song={{ chart, buffer: loaded.buffer, title }}
      initialMode={mode}
      levels={loaded.levels.length > 0 ? loaded.levels.map((l) => ({ level: l.level, name: l.name, notes: l.chart.notes.length })) : undefined}
      level={current?.level}
      onLevel={onLevel}
      onFinish={(r) => onFinish(r, title, next ? { level: next.level, name: next.name } : undefined)}
      onQuit={onQuit}
    />
  );
}
